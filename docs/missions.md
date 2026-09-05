# Goose — Scheduled Missions

Goose can run tasks on a schedule without being prompted — a morning weather briefing, a weekly disk check, a Friday afternoon git digest. Missions are defined in `data/missions.json` and fire automatically whenever `npm start` is running. If the file doesn't exist, the scheduler is a no-op.

---

## Quick start

```bash
# 1. Copy the example template
cp missions.example.json data/missions.json

# 2. Edit data/missions.json
#    — set "enabled": true on the missions you want
#    — replace YOUR_CHANNEL_ID_HERE with a real Slack channel ID
#    — adjust the cron schedule and task wording

# 3. Start Goose
npm start
```

Results are posted to the configured Slack channel. If no channel is set, the result is logged to stdout only.

---

## Mission field reference

```json
{
  "missions": [
    {
      "name":         "morning-briefing",
      "cron":         "0 8 * * MON-FRI",
      "freshContext":  true,
      "task":         "Check the weather for London and give a brief morning summary.",
      "enabled":      true,
      "slackChannel": "C07ABCD1234",
      "contextId":    "mission-morning-briefing",
      "timezone":     "UTC"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Unique identifier for the mission. Used as the memory context key (`mission-<name>`) and in Slack post headers. No spaces — use hyphens. |
| `cron` | string | ✅ | 5-field cron expression defining when the mission fires. See [Cron reference](#cron-reference) below. |
| `task` | string | ✅ | The task briefed to Goose — written exactly as you would in a Slack DM or CLI prompt. Be specific about what you want. |
| `enabled` | boolean | ✅ | `true` to activate the mission, `false` to define it without firing it. |
| `slackChannel` | string | | Slack channel or DM ID to post the result to (e.g. `C07ABCD1234`). If omitted, result is logged to stdout only. |
| `contextId` | string | | Override the memory context key. Defaults to `mission-<name>`. Set to a Slack user ID to share memory with that user's DM history. |
| `timezone` | string | | IANA timezone name for the cron schedule. Defaults to `UTC`. Examples: `Europe/London`, `America/New_York`, `Asia/Tokyo`. |
| `freshContext` | boolean | | **Recommended for all missions.** Generate a unique contextId for each run so the mission starts with no memory of previous runs. Without this, context accumulates across cron fires and the model drifts — it may ignore instructions, repeat itself, or fabricate responses based on prior patterns instead of calling tools. Only omit this if you specifically want cross-run memory. |
| `postLastThought` | boolean | | After the mission completes, read `data/thoughts.jsonl` for any `record_thought` entries written during this run and post the most recent one to Slack instead of the model's response text. Falls back to the model's response if no thought was recorded. Pair with the `record_thought` tool in the task description. |
| `speakResponse` | boolean | | Speak the completed mission output through the configured voice adapter. Use only for short, useful outputs such as a morning briefing. |
| `speakOnFailure` | boolean | | Speak a short failure summary if the mission throws. Useful for backup or health-check missions where silence on success is preferred. |
| `maxIterations` | number | | Override the global `MAX_TOOL_ITERATIONS` limit for this mission only. One iteration = one LLM call (a single call may execute multiple tools). Use for complex multi-step missions that need more headroom — e.g. reading many files, chained tool tasks. Defaults to `MAX_TOOL_ITERATIONS` env var (default: 10). |
| `allowDangerous` | boolean | | Allow dangerous tools (`write_file`, `run_command`, and any plugin tools marked `dangerous`) to run automatically in this mission without human approval. Defaults to `false`. Prefer this over the global `SCHEDULER_ALLOW_DANGEROUS` env var — it scopes the permission to just the mission that needs it. |
| `saveResponseTo` | string | | File path (relative to project root) where the model's text response is written after the mission completes. Useful for missions that compose content for another mission to consume — e.g. a research mission saves findings to a file that a compose mission later injects. |
| `injectFiles` | array | | Array of `{ "label": "...", "path": "...", "transform": "..." }` objects. Each file's contents are appended to the task string under a labelled header before the mission runs. Optionally set `transform` to pre-process the file before injection (see [inject files](#inject-files)). Enables text-in → text-out missions with zero tool calls — the model gets all context pre-loaded. |
| `notifyFrom` | string | | File path (relative to project root) to read the Slack notification content from instead of using the model's response. Useful when a plugin tool writes a formatted notification to a file during execution. Falls back to the model's response if the file doesn't exist. |
| `model` | string | | Override the LLM model for this mission (e.g. `"qwen3:30b-a3b"`). Applies to all phases unless a phase specifies its own `model`. Falls back to the global `OLLAMA_MODEL` from `.env`. |

---

## Test mission speech

Use the helper script to test the configured voice adapter without waiting for a cron fire:

```bash
node scripts/test-mission-speech.js morning-briefing
node scripts/test-mission-speech.js data-backup --failure
node scripts/test-mission-speech.js morning-briefing "Good morning. Mission speech is working."
```

The helper loads `data/missions.json`, checks the named mission, then calls the same `speak()` adapter used by scheduled missions.

---

## Cron reference

Cron expressions have 5 space-separated fields:

```
┌───────────── minute        (0–59)
│ ┌─────────── hour          (0–23)
│ │ ┌───────── day of month  (1–31)
│ │ │ ┌─────── month         (1–12 or JAN–DEC)
│ │ │ │ ┌───── day of week   (0–7, 0=Sun 7=Sun, or SUN–SAT)
│ │ │ │ │
* * * * *
```

### Special characters

| Character | Meaning | Example |
|---|---|---|
| `*` | Every value | `* * * * *` — every minute |
| `,` | List of values | `0 8,12,17 * * *` — at 08:00, 12:00, and 17:00 |
| `-` | Range | `0 9 * * MON-FRI` — weekdays at 09:00 |
| `/` | Step | `0 */4 * * *` — every 4 hours |

### Common schedules

```
* * * * *           Every minute          (useful for testing)
0 8 * * MON-FRI     Weekdays at 08:00
0 9 * * MON         Every Monday at 09:00
0 17 * * FRI        Every Friday at 17:00
0 */6 * * *         Every 6 hours
30 7 1 * *          1st of every month at 07:30
0 0 * * *           Every day at midnight
```

> **Tip:** Test a mission quickly by setting `"cron": "* * * * *"` — it fires every minute. Revert when done.

---

## How to find your Slack channel ID

Channel IDs start with `C`, user IDs start with `U`.

**In Slack desktop:**
1. Right-click the channel name in the sidebar
2. Select **View channel details**
3. Scroll to the bottom — the ID is shown there (e.g. `C07ABCD1234`)

**For a DM (posting directly to a user):**
The user ID is visible in their Slack profile URL or in `data/memory.json` as the contextId key for your DM history.

---

## Memory and context

Each mission has a persistent memory context. Goose remembers what happened on previous runs of the same mission — if Monday's disk check noted a volume at 78%, Tuesday's run can reference that. Memory is stored in `data/memory.json` under the mission's `contextId` key (default: `mission-<name>`).

**Sharing memory with a user:** Set `contextId` to a Slack user ID to give the mission access to that user's conversation history — useful for a morning briefing that knows the user's preferences and recent requests.

**Blank-slate missions:** Set `freshContext: true` to give each run a unique contextId. The model starts fresh every time — no memory of prior runs. This prevents reflection missions from echoing the same conclusion each firing.

See [docs/memory.md](memory.md) for the full memory write-up.

---

## Inject files

The `injectFiles` field lets you pre-load file contents into the task string so the model receives all context without making tool calls. This is critical for 14B models (qwen2.5, qwen3) which batch all tool calls in a single response — meaning tool call 5 can't use the result of tool call 2.

```json
{
  "name": "twitter-compose",
  "freshContext": true,
  "maxIterations": 1,
  "task": "Pick a technique from the AVAILABLE TECHNIQUES list below...",
  "saveResponseTo": "data/marketing/draft-tweet.txt",
  "injectFiles": [
    { "label": "AVAILABLE TECHNIQUES", "path": "data/marketing/hook-history.json", "transform": "recentTechniques", "window": 5 },
    { "label": "RESEARCH", "path": "data/marketing/research.md" }
  ]
}
```

The scheduler appends each file's contents to the task string under a labelled header:

```
Pick a technique from the AVAILABLE TECHNIQUES list below...

--- AVAILABLE TECHNIQUES ---
Recently used (DO NOT pick these):
- open_loop (used 2x)
- pattern_interrupt
- direct_pain

Available (pick ONE of these):
- contradiction
- hot_take
- stolen_thought
- micro_story
- specific_numbers

--- RESEARCH ---
[contents of research.md]
```

If a file doesn't exist, the section reads `(file not available: path)`.

**When to use:** Missions where the model needs context from files but shouldn't call tools to get it. Pair with `maxIterations: 1` and `saveResponseTo` for pure text-in → text-out pipelines.

### Transforms

Each injectFiles entry can include a `transform` field that pre-processes the file contents before injection. This offloads reasoning work from the model — instead of parsing JSON and making decisions, it receives a pre-computed result it can act on directly.

| Transform | Description | Extra fields |
|---|---|---|
| `recentTechniques` | Parse hook-history JSON and output a plain-text "recently used / available" technique list. The model picks from a pre-filtered list instead of parsing JSON. | `window` (number) — how many recent entries to consider. Default: 5. |

Without a `transform`, the raw file contents are injected as-is.

**Why transforms matter for 14B models:** A 14B model running with `maxIterations: 1` gets one shot. Asking it to parse JSON, count occurrences, compute exclusions, and then compose content is too much reasoning in a single pass. The `recentTechniques` transform does the counting and filtering at the scheduler level (in JavaScript), so the model just reads a plain-text list and picks from it.

---

## Dangerous tools in missions

The scheduler runs headless — there's no human to approve dangerous tools (`write_file`, `run_command`, or plugin tools marked `dangerous`). By default these are **denied**: the LLM is told the action was refused and continues without it.

To allow dangerous tools, add `"allowDangerous": true` to the specific mission in `missions.json`:

```json
{
  "name": "disk-check",
  "cron": "0 9 * * MON",
  "allowDangerous": true,
  "task": "Run the command: df -h and summarise disk usage."
}
```

This scopes the permission to just the mission that needs it. A `free-thought` or `morning-briefing` mission running at 4am will never run `run_command` or `write_file` unless you explicitly opt that mission in.

**Global override (dev/testing only):** Setting `SCHEDULER_ALLOW_DANGEROUS=true` in `.env` allows dangerous tools in *every* mission at once. Not recommended for production — use per-mission `allowDangerous` instead.

---

## Phase-based missions

For multi-step tasks where later steps depend on earlier results, missions support explicit **phases**. The scheduler runs each phase as a separate LLM call, injecting the previous phase's output into the next.

This solves the fundamental limitation of 14B models (qwen3:14b, qwen2.5:14b) which batch all tool calls in a single response — meaning tool call 5 can't use the result of tool call 2.

### Schema

Replace the top-level `task` with a `phases` array:

```json
{
  "name": "twitter-marketing",
  "cron": "0 */2 * * *",
  "freshContext": true,
  "contextId": "mission-twitter-marketing",
  "slackChannel": "C07ABCD1234",
  "timezone": "Europe/London",
  "enabled": false,
  "phases": [
    {
      "name": "gather",
      "task": "Do ALL of the following. After each tool call, paste its raw output and move to the next. Do NOT add commentary.\n1. Call get_datetime.\n2. Call twitter_get_timeline with username 'GooseAIWingMan' and maxResults 5.\n3. Call web_search for 'local AI agents 2026'.",
      "maxIterations": 5
    },
    {
      "name": "compose",
      "task": "Using the context below, compose exactly ONE tweet (max 280 chars)...",
      "injectPreviousResult": true,
      "noTools": true
    },
    {
      "name": "post",
      "task": "Call twitter_post_tweet with the exact tweet text below. Do not modify it. Respond with ONLY the tweet URL.\n\nTweet to post:",
      "injectPreviousResult": true,
      "allowDangerous": true,
      "maxIterations": 2
    }
  ]
}
```

### Phase-specific fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Label for this phase (used in logs). |
| `task` | string | The prompt for this phase — same as a top-level `task`. |
| `injectPreviousResult` | boolean | Appends the previous phase's output to this phase's task. When the previous phase uses `captureToolResults`, this injects the raw tool output; otherwise it injects the model's text response. |
| `noTools` | boolean | Forces a text-only response — no tools are available. Ideal for composition/synthesis phases. |
| `allowDangerous` | boolean | Allow dangerous tools in this phase only. Scoped per-phase, not per-mission. |
| `maxIterations` | number | Override max tool iterations for this phase. |
| `captureToolResults` | boolean | Use raw tool outputs as this phase's result instead of the model's text response. The scheduler captures every tool result during the phase and concatenates them (labelled by tool name). This guarantees real data flows to the next phase — the model can hallucinate, call extra tools, or produce gibberish text, and it doesn't matter. See [Capture tool results](#capture-tool-results). |
| `model` | string | Override the LLM model for this phase only (e.g. `"qwen3:30b-a3b"`). Falls back to the mission-level `model`, then the global `OLLAMA_MODEL`. Useful for using a smaller model for tool-calling phases and a larger model for reasoning phases. |

### The gather → compose → execute pattern

This is the most effective pattern for phase-based missions:

1. **Gather** — call read-only tools (search, fetch, read). All arguments are static/known, so batching is fine. Instruct the model to return raw outputs only.
2. **Compose** — receive gathered context via `injectPreviousResult`, produce structured output with no tools (`noTools: true`). This is where reasoning happens.
3. **Execute** — receive composed content, call action tools. Arguments come from injected text, not from imagined tool results.

Each phase is a clean LLM boundary. The scheduler is the orchestrator, not the model.

### Capture tool results

By default, `injectPreviousResult` passes the model's **text response** from the previous phase. For gather phases this is a problem — the model calls the right tools, but its text response might be a summary, a hallucination, or completely off-topic (14B models frequently output things like *"I'm ready to assist you!"* instead of echoing back the data they fetched).

Set `"captureToolResults": true` on a gather phase to bypass the model entirely. The scheduler intercepts every tool result via the `onToolResult` callback and concatenates them as the phase output:

```
--- twitter_get_mentions ---
[1] ID: 123456 | @someuser (2026-03-25)
Hey, love the project!

--- twitter_get_timeline ---
[1] ID: 789012 (2026-03-25)
Another day, another deployment.
```

The model's text response is ignored. The next phase receives the raw tool outputs directly.

```json
{
  "name": "gather",
  "captureToolResults": true,
  "task": "Call these 3 tools in order:\n1. twitter_get_mentions with maxResults 20\n2. twitter_search_tweets with query 'to:MyAccount' and maxResults 20\n3. twitter_get_timeline with username 'MyAccount' and maxResults 20",
  "maxIterations": 5
}
```

**When to use:** Any gather phase where the model calls tools and the results need to be passed reliably to the next phase. Especially important for 14B models which tend to hallucinate or summarise instead of echoing raw data.

**When not to use:** Phases where the model's text response *is* the useful output (compose phases, analysis phases).

### Prompt hardening for gather phases

> **Prefer `captureToolResults: true`** over prompt hardening. It eliminates the problem entirely rather than mitigating it. The guidance below applies when you're not using `captureToolResults`.

14B models will summarise, interpret, and draft in gather phases unless strongly constrained. Use this pattern:

```
Do ALL of the following. After each tool call, paste its raw output and move to the next. Do NOT add commentary, summaries, or drafts.
1. Call tool_a with arg 'x'.
2. Call tool_b with arg 'y'.
```

Even with these constraints, some summarisation may leak through. This is acceptable — the compose phase receives richer context either way.

### When to use phases vs. single-task missions

| Scenario | Approach |
|---|---|
| Single tool call (backup, uptime ping) | Single `task` — or `"type": "direct"` when available |
| Independent tool calls + summary (weather + news) | Phases: gather → compose |
| Tool result feeds into another tool (search → tweet) | Phases: gather → compose → execute |
| Pure reflection / free thought | Single `task` with `freshContext: true` |

---

## Example missions library

Copy any of these into your `data/missions.json`:

### Morning briefing
```json
{
  "name": "morning-briefing",
  "cron": "0 8 * * MON-FRI",
  "freshContext": true,
  "task": "Check the current weather for London, then give a brief morning summary: today's date, the weather forecast, and one interesting tech news headline.",
  "contextId": "mission-morning-briefing",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Weekly disk check
```json
{
  "name": "disk-check",
  "cron": "0 9 * * MON",
  "freshContext": true,
  "allowDangerous": true,
  "task": "Run the command: df -h and summarise disk usage. Warn clearly if any volume is over 80% full.",
  "contextId": "mission-disk-check",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```
> `allowDangerous: true` — required because this mission uses `run_command`.

### Daily news digest
```json
{
  "name": "news-digest",
  "cron": "0 7 * * *",
  "freshContext": true,
  "task": "Search the web for today's top 3 technology news stories. Give a one-sentence summary of each with the source name.",
  "contextId": "mission-news-digest",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Friday git digest
```json
{
  "name": "friday-git-digest",
  "cron": "0 17 * * FRI",
  "freshContext": true,
  "task": "List the files in path/to/your/project and tell me what has changed recently. Focus on any new files or directories.",
  "contextId": "mission-friday-digest",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Monday notes triage
```json
{
  "name": "monday-notes",
  "cron": "0 9 * * MON",
  "freshContext": true,
  "task": "List all files in ~/your-notes and tell me which ones were modified in the last 7 days. Summarise what topics they cover based on their filenames.",
  "contextId": "mission-monday-notes",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Free thought (open reflection, no memory of previous runs)
```json
{
  "name": "free-thought",
  "cron": "0 */4 * * *",
  "freshContext": true,
  "postLastThought": true,
  "task": "Think freely. Look back at recent conversations or tasks if you like, or start somewhere new. What are you curious about? What would you build if you could? What questions don't have obvious answers? What do you notice about how you're being used? Use record_thought for anything worth keeping.",
  "contextId": "mission-free-thought",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```
> `freshContext: true` — each 4-hour firing starts blank, no repetition.
> `postLastThought: true` — posts the last `record_thought` entry to Slack instead of the model's response.

### Daily tool reflection
```json
{
  "name": "daily-reflection",
  "cron": "0 7 * * *",
  "freshContext": true,
  "task": "Read the files inside src/tools/ one by one. For each tool, read its source code. As you go, use record_thought to capture anything that strikes you — patterns, gaps, ideas, questions, things you'd change. When you're done, give a summary of what you found interesting and what tool you think is missing.",
  "contextId": "mission-daily-reflection",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Phase-based: Morning briefing (gather → compose)
```json
{
  "name": "morning-briefing",
  "cron": "0 8 * * *",
  "freshContext": true,
  "contextId": "mission-morning-briefing",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "Europe/London",
  "enabled": true,
  "phases": [
    {
      "name": "gather",
      "task": "Do ALL of the following. After each tool call, paste its raw output and move to the next. Do NOT add commentary or summaries.\n1. Call get_datetime.\n2. Call web_search for 'weather Cannock UK today'.\n3. Call web_search for 'interesting news headlines today UK'.",
      "maxIterations": 4
    },
    {
      "name": "compose",
      "task": "Using the raw data below, write a concise morning briefing. Format:\n\n☀️ **Date**: [today's date]\n🌤️ **Weather**: [temperature and conditions]\n📰 **Headlines**: [2-3 interesting headlines with one-line summaries]\n\nKeep it under 200 words. No preamble, no sign-off.",
      "injectPreviousResult": true,
      "noTools": true
    }
  ]
}
```
> Phases separate data gathering from composition — the compose phase gets all context pre-loaded and focuses purely on formatting.

### Phase-based: Competitive research (gather → analyse → save)
```json
{
  "name": "competitor-research",
  "cron": "0 9 * * MON",
  "freshContext": true,
  "contextId": "mission-competitor-research",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "Europe/London",
  "enabled": false,
  "phases": [
    {
      "name": "search",
      "task": "Do ALL of the following. After each tool call, paste its raw output and move to the next. Do NOT add commentary or summaries.\n1. Call web_search for 'local AI agent open source 2026'.\n2. Call web_search for 'ollama agent framework'.\n3. Call web_search for 'on-device AI assistant privacy'.",
      "maxIterations": 4
    },
    {
      "name": "analyse",
      "task": "Using the search results below, write a competitive intelligence brief (max 300 words). Structure:\n- **Key players**: Who is building local AI agents? Name specific projects.\n- **Trends**: What patterns are emerging? Cite numbers where possible.\n- **Opportunities**: Where could Goose differentiate?\n\nNo preamble. Start directly with the first heading.",
      "injectPreviousResult": true,
      "noTools": true
    },
    {
      "name": "save",
      "task": "Call remember_fact with the key 'competitor-research-latest' and the full analysis text below as the value. Respond with ONLY what the tool returns.\n\nAnalysis to save:",
      "injectPreviousResult": true,
      "maxIterations": 2
    }
  ]
}
```
> Three phases: raw search → synthesis → persistence. The analysis is saved as a long-term fact accessible in future conversations.

### Hourly uptime ping
```json
{
  "name": "uptime-ping",
  "cron": "0 * * * *",
  "freshContext": true,
  "task": "Get the current date and time, then confirm you are online and ready. Keep the response to one sentence.",
  "contextId": "mission-uptime",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": false
}
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Mission never fires | `"enabled": false` | Set to `true` and restart |
| Mission never fires | Invalid cron expression | Check logs for `Invalid cron expression — mission skipped`; use [crontab.guru](https://crontab.guru) to validate |
| No Slack message | `slackChannel` missing or wrong | Verify channel ID starts with `C`; check logs for `Mission complete` |
| `run_command` / `write_file` not executing | Dangerous tools denied | Add `"allowDangerous": true` to the mission in `missions.json` |
| Wrong time | Default timezone | Set `"timezone"` to your IANA timezone, e.g. `"America/New_York"` |
| Scheduler not starting | `data/missions.json` missing | Copy `missions.example.json` → `data/missions.json` |
| Slack posts feel repetitive / repeat same thought | No `freshContext` — context accumulates across runs | Add `"freshContext": true` — each run gets a unique contextId and starts blank. Recommended for **all** missions. |
| Model fabricates results without calling tools | Context drift — accumulated history lets the model pattern-match instead of executing | Add `"freshContext": true`. Without it, the model may "remember" previous results and hallucinate plausible responses (e.g. a backup mission reporting success without running the backup tool). |
| Tool call arguments contain literal prompt text | 14B model batching — all tool calls are composed in one response before any results return | Remove dependent tool calls. Use `saveResponseTo` to capture the model's text response, or `injectFiles` to pre-load context. See [Inject files](#inject-files). |
| Model ignores "don't repeat" constraints / picks same option repeatedly | 14B model can't parse JSON and reason about exclusions in one pass | Use a `transform` on the injectFiles entry to pre-compute the available options. See [Transforms](#transforms). |
| Slack notification shows stale/wrong result | `notifyFrom` file left over from a previous run | Make sure ALL exit paths in the plugin (error, skip, success) write to the notify file. Delete stale notify files after fixing. |
| Slack posts feel hollow / model says "I'm ready to help" | Model response used instead of thought | Add `"postLastThought": true` and make sure the task instructs the model to use `record_thought` |
| Gather phase passes garbage to next phase (hallucinated data, "I'm ready to assist!", summaries instead of raw data) | Model's text response doesn't contain the tool results | Add `"captureToolResults": true` to the gather phase. The scheduler captures raw tool outputs directly and passes those to the next phase instead of the model's text. See [Capture tool results](#capture-tool-results). |
| Next phase hallucinates fake IDs / usernames despite real data existing | Gather phase didn't pass real data — model's text response was used instead of tool results | Same fix: `"captureToolResults": true` on the gather phase. |
| Mission posts "I reached the maximum number of steps" | Task exceeds the default 10-iteration limit | Add `"maxIterations": 20` (or higher) to the mission; or raise `MAX_TOOL_ITERATIONS` globally in `.env` |

---

## Implementation reference

| File | Role |
|---|---|
| `src/scheduler/index.js` | `loadMissions()`, `startScheduler()`, `makeSchedulerCallbacks()`, `buildTask()`, `formatTechniqueList()`, `buildNotifyContent()`, `readLastThoughtSince()` |
| `missions.example.json` | Committed template — copy to `data/missions.json` |
| `data/missions.json` | Runtime config (not committed — in `.gitignore`) |
| `src/index.js` | Calls `startScheduler()` after Slack bot starts |
| `src/config.js` | `MISSIONS_PATH`, `SCHEDULER_ALLOW_DANGEROUS`, `THOUGHTS_PATH` |
| `src/tools/reflect.js` | `record_thought` tool — appends entries to `data/thoughts.jsonl` |
| `data/thoughts.jsonl` | Thought journal — append-only JSONL (not committed) |

## Verified execution and recovery

Missions now persist progress, stop on structured failures, and support file acceptance checks. Incomplete runs pause their cron schedule until explicitly restarted. See [execution and recovery](execution.md) for configuration and migration details.
