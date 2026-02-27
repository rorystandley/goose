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
| `freshContext` | boolean | | Generate a unique contextId for each run. The mission starts with no memory of previous runs — each firing is a blank slate. Useful for open-ended reflection tasks where you don't want the model to repeat prior conclusions. |
| `postLastThought` | boolean | | After the mission completes, read `data/thoughts.jsonl` for any `record_thought` entries written during this run and post the most recent one to Slack instead of the model's response text. Falls back to the model's response if no thought was recorded. Pair with the `record_thought` tool in the task description. |
| `maxIterations` | number | | Override the global `MAX_TOOL_ITERATIONS` limit for this mission only. One iteration = one LLM call (a single call may execute multiple tools). Use for complex multi-step missions that need more headroom — e.g. reading many files, chained tool tasks. Defaults to `MAX_TOOL_ITERATIONS` env var (default: 10). |

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

## Dangerous tools in missions

The scheduler runs headless — there's no human to approve dangerous tools (`write_file`, `run_command`). By default these are **denied**: the LLM is told the action was refused and produces a response without it.

To allow dangerous tools in scheduled missions, set in `.env`:

```
SCHEDULER_ALLOW_DANGEROUS=true
```

> **Note:** The `disk-check` example task uses `run_command: df -h` which is a dangerous tool. It requires `SCHEDULER_ALLOW_DANGEROUS=true` to actually run the command. Without it, Goose will describe the disk check but won't execute the command.

---

## Example missions library

Copy any of these into your `data/missions.json`:

### Morning briefing
```json
{
  "name": "morning-briefing",
  "cron": "0 8 * * MON-FRI",
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
  "task": "Run the command: df -h and summarise disk usage. Warn clearly if any volume is over 80% full.",
  "contextId": "mission-disk-check",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```
> Requires `SCHEDULER_ALLOW_DANGEROUS=true` — uses `run_command`.

### Daily news digest
```json
{
  "name": "news-digest",
  "cron": "0 7 * * *",
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
  "task": "Read the files inside src/tools/ one by one. For each tool, read its source code. As you go, use record_thought to capture anything that strikes you — patterns, gaps, ideas, questions, things you'd change. When you're done, give a summary of what you found interesting and what tool you think is missing.",
  "contextId": "mission-daily-reflection",
  "slackChannel": "YOUR_CHANNEL_ID",
  "timezone": "UTC",
  "enabled": true
}
```

### Hourly uptime ping
```json
{
  "name": "uptime-ping",
  "cron": "0 * * * *",
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
| `run_command` / `write_file` not executing | Dangerous tools denied | Set `SCHEDULER_ALLOW_DANGEROUS=true` in `.env` |
| Wrong time | Default timezone | Set `"timezone"` to your IANA timezone, e.g. `"America/New_York"` |
| Scheduler not starting | `data/missions.json` missing | Copy `missions.example.json` → `data/missions.json` |
| Slack posts feel repetitive / repeat same thought | No `freshContext` on reflection missions | Add `"freshContext": true` — each run gets a unique contextId and starts blank |
| Slack posts feel hollow / model says "I'm ready to help" | Model response used instead of thought | Add `"postLastThought": true` and make sure the task instructs the model to use `record_thought` |
| Mission posts "I reached the maximum number of steps" | Task exceeds the default 10-iteration limit | Add `"maxIterations": 20` (or higher) to the mission; or raise `MAX_TOOL_ITERATIONS` globally in `.env` |

---

## Implementation reference

| File | Role |
|---|---|
| `src/scheduler/index.js` | `loadMissions()`, `startScheduler()`, `makeSchedulerCallbacks()`, `readLastThoughtSince()` |
| `missions.example.json` | Committed template — copy to `data/missions.json` |
| `data/missions.json` | Runtime config (not committed — in `.gitignore`) |
| `src/index.js` | Calls `startScheduler()` after Slack bot starts |
| `src/config.js` | `MISSIONS_PATH`, `SCHEDULER_ALLOW_DANGEROUS`, `THOUGHTS_PATH` |
| `src/tools/reflect.js` | `record_thought` tool — appends entries to `data/thoughts.jsonl` |
| `data/thoughts.jsonl` | Thought journal — append-only JSONL (not committed) |
