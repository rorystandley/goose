# Verified, recoverable execution

Kanban tasks and scheduled missions use a persistent workflow engine. Interactive
Slack, CLI, web chat, and voice still receive text from `runAgent()`; persistent
recovery currently applies to Kanban and missions.

## Use it from the board

Create or edit a task and enter **Required output files**, one file path per line.
Use absolute paths, `~/...`, or paths relative to Goose's working directory. Tell
Goose what to put in those files in the task description.

An output check reads the file back, requires nonempty content, and rejects an
unchanged file left over from before the run. Only passing checks earn a
**Verified** badge. Tasks without output checks retain the previous completion
behaviour, but show **No output checks** and cannot pass known execution errors
off as success.

Failed, denied, and step-limited tasks appear under **Needs attention**. Expand the
card to read the result and verification failures. Review previous actions before
choosing **Reopen**, which starts a new run when you move the task to Ready again.

## Mission acceptance checks

Add `acceptance` to a mission, a phase, or a task created through the Kanban API:

```json
{
  "name": "verified-briefing",
  "cron": "0 8 * * MON-FRI",
  "enabled": true,
  "task": "Research five distinct stories with source URLs and write a briefing to data/briefing.md. Include a Sources section.",
  "allowDangerous": true,
  "acceptance": [
    {
      "type": "file",
      "path": "data/briefing.md",
      "minBytes": 300,
      "contains": ["## Sources", "https://"]
    }
  ]
}
```

These checks establish a saved, nonempty artifact containing the required text.
They do **not** establish that five stories are distinct or that the sources are
accurate. Choose checks that match the guarantees you actually need.

Each check supports:

| Field | Meaning |
|---|---|
| `type` | Currently `file` only |
| `path` | File to read back |
| `minBytes` | Minimum positive byte count; defaults to 1 |
| `maxAgeHours` | Optional maximum file age, based on modification time |
| `contains` | Array of literal strings that must all occur |
| `jsonKeys` | Parse as JSON and require these top-level keys |
| `allowUnchanged` | Accept an existing unchanged artifact; defaults to false |

Phase checks run before downstream phases. Mission checks run after all phases.
`saveResponseTo` is now a persisted stage with an automatic read-back check; a
save failure fails the mission. Direct dangerous tools now honour the same
mission approval policy as agent tools. `captureToolResults` includes results
retained in the checkpoint when a phase resumes.

## Recovery and limits

- Run records live in `data/runs/`; override with `RUNS_PATH`.
- Checkpoints include the working messages, model, iteration count, tool calls,
  tool results, completed stages, and artifact baselines. Writes use a temporary
  file, fsync, and atomic rename. Records have owner-only file permissions.
- A process lock prevents concurrent workers from owning the same run. Dead
  owners can be recovered on the same machine. Do not share this directory
  between different hosts; PID locks assume one host.
- Transient inference errors retry up to three total attempts, with exponential
  backoff. Missions may set `maxAttempts` from 1 to 5. Retries preserve completed
  tools and the original iteration budget.
- On startup, enabled missions resume interrupted occurrences. The Kanban
  watcher recovers abandoned in-progress tasks before taking new work.
- A crash during a tool action leaves its outcome uncertain. Goose blocks that
  run instead of replaying it. Approvals are not a guarantee that repetition is
  safe. Legacy in-progress Kanban tasks without checkpoints also require review.
- An incomplete mission pauses future cron executions. In Ops, choose **Start
  new run** after reviewing prior actions. The API equivalent is
  `POST /api/missions/:name/trigger` with `{"startNew":true}`.
- Failed artifact checks stop the workflow; this version does not automatically
  rewrite artifacts or invent a new plan. Iteration exhaustion requires a new,
  revised run rather than silently extending the budget.
- Completed scheduled occurrences start fresh on the next cron tick. Mission
  run records retain the latest occurrence; Kanban reopening uses a new run ID.
  Slack notification and speech delivery happen after execution and are not
  covered by tool checkpoint recovery.

If lock metadata is damaged or a process dies while cleaning up a stale lock,
stop all Goose processes before removing the affected `.lock` directory. Keep
the run JSON so the executor can inspect any uncertain tool outcome.

## Structured agent API

```js
const outcome = await runAgent(task, contextId, {
  ...callbacks,
  structured: true,
});
// { status, result, verified: false, iterations, toolResults, reason?, retryable? }
```

Statuses are `completed`, `failed`, `blocked`, and `budget_exhausted`. The core
loop never claims artifact verification; the workflow verifier adds `verified`
and `evidence`. A normal final response only establishes completion without
checks. Legacy tools return strings, so known error prefixes are conservatively
recognised; custom plugin error formats still need explicit acceptance checks.

`src/execution/workflow.js` owns stage progression, inference retries, and
verification. `src/execution/store.js` owns persistence and locking.
`src/kanban/execute.js` is shared by manual and background task execution.

## Research-to-deliverable missions

`missions.verified.example.json` contains disabled templates for a morning
briefing, a backup receipt, pain research using installed web-search tools, and
product drafting. Configure the city and notification channels before enabling.
The research flow uses search snippets as evidence and explicitly labels their
limitations; it does not invent Reddit engagement statistics or claim that
citations were independently verified.

A mission may specify `inputs`, using the same file checks as `acceptance`.
Inputs are checked before the first stage. For example, product drafting can
require `data/pain-points.md` with `maxAgeHours: 48`. Missing, stale, or malformed
inputs block execution until reviewed and restarted. File age measures when
Goose generated the report, not when each underlying source was published.

`allowedTools` on a mission or phase limits its model-visible tools to installed
names. Invalid tool names fail configuration validation before the mission runs.
`noTools` still disables all tools. Tool allowlists do not grant approval for
dangerous actions; the existing approval policy applies.

Search, backup, and Twitter plugin failure envelopes are recognised as failures
by both agent and direct execution paths. A missing provider or a failed backup
cannot pass merely because it returned a string.

Ollama missions may set `contextTokens` (or override it per phase). The verified
examples use 16384 tokens so gathered sources and multi-file drafts fit in the
working context. This overrides Ollama `num_ctx` for that run; vLLM context
capacity remains a server setting.
