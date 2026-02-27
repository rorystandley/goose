# Goose — Proactive Monitors

Monitors let Goose watch things and act on changes — without being prompted. Instead of time-based triggers (cron), monitors fire on events: a URL going down, a file changing, or CPU spiking past a threshold.

Monitors are defined in `data/monitors.json` and start automatically whenever `npm start` or `npm run cli` (REPL mode) is running. If the file doesn't exist, the monitor system is a no-op.

---

## Quick start

```bash
# 1. Copy the example template
cp monitors.example.json data/monitors.json

# 2. Edit data/monitors.json
#    — set "enabled": true on the monitors you want
#    — replace YOUR_CHANNEL_ID_HERE with a real Slack channel ID
#    — adjust paths, URLs, thresholds, and task wording

# 3. Start Goose
npm start
```

When a monitor triggers, Goose runs the configured task and posts the result to the Slack channel (if set), or logs it to stdout.

---

## Monitor field reference

```json
{
  "monitors": [
    {
      "name":         "server-health",
      "type":         "url",
      "url":          "https://example.com/health",
      "interval":     "5m",
      "cooldown":     "10m",
      "task":         "The URL {url} returned {status}. Summarise the situation.",
      "contextId":    "monitor-server-health",
      "slackChannel": "C07ABCD1234",
      "enabled":      true
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Unique identifier. Used as the memory context key (`monitor-<name>`) and in Slack post headers. No spaces — use hyphens. |
| `type` | string | ✅ | Monitor type: `url`, `file`, or `system`. |
| `interval` | string | | How often to poll. See [Interval syntax](#interval-syntax) below. Default: `5m`. |
| `cooldown` | string | | Minimum gap between consecutive trigger firings for this monitor. Prevents alert spam when a condition persists. Default: `10m`. |
| `task` | string | ✅ | Task briefed to Goose when the monitor triggers — same format as a Slack DM or CLI prompt. Supports [template variables](#template-variables). |
| `contextId` | string | | Memory context key override. Defaults to `monitor-<name>`. |
| `slackChannel` | string | | Slack channel or DM ID to post the result to. If omitted, result is logged to stdout only. |
| `enabled` | boolean | ✅ | `true` to activate, `false` to define without starting. |

### Type-specific fields

| Field | Type | Used by | Description |
|---|---|---|---|
| `url` | string | `url` | The URL to poll. |
| `path` | string | `file` | Absolute or relative path to the file or directory to watch. |
| `metric` | string | `system` | `cpu` or `memory`. |
| `threshold` | number | `system` | Percentage (0–100) above which the monitor triggers. |

---

## Interval syntax

Intervals and cooldowns use a human-readable string format:

| Value | Meaning |
|---|---|
| `"30s"` | 30 seconds |
| `"5m"` | 5 minutes |
| `"2h"` | 2 hours |
| `"1d"` | 1 day |
| `"10"` | 10 minutes (unit defaults to minutes) |

---

## Template variables

The `task` field supports placeholder tokens replaced at trigger time:

| Variable | Available in | Description |
|---|---|---|
| `{url}` | `url` | The URL being monitored |
| `{status}` | `url` | HTTP status code, or `network error (message)` |
| `{path}` | `file` | The file path being monitored |
| `{mtime}` | `file` | Last modified time as ISO string |
| `{metric}` | `system` | The metric name: `cpu` or `memory` |
| `{value}` | `system` | The measured value as a percentage string |
| `{threshold}` | `system` | The configured threshold |

---

## Monitor types

### `url` — HTTP health check

Polls an HTTP endpoint on each interval. Triggers when:
- The response status is **≥ 400** — service is degraded or down
- The request **fails entirely** (network error, timeout) — service is unreachable
- The URL **recovers** (goes from failing to 2xx) — back up after an outage

```json
{
  "name": "api-health",
  "type": "url",
  "url": "https://api.example.com/ping",
  "interval": "2m",
  "cooldown": "10m",
  "task": "The API at {url} returned {status}. Check if this is an outage or a transient error.",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

---

### `file` — Filesystem change watcher

Polls a file or directory's modification time. Triggers when the `mtime` changes between checks.

Uses `mtime` polling rather than native `fs.watch()` — more portable across platforms and doesn't miss rapid file changes.

```json
{
  "name": "env-watch",
  "type": "file",
  "path": "path/to/.env",
  "interval": "1m",
  "cooldown": "5m",
  "task": "The file {path} was modified at {mtime}. Read it and note any changes to environment variables.",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

> **Note:** The first check always records the current mtime without triggering — a baseline read. Only subsequent checks compare against the baseline.

---

### `system` — Resource threshold monitor

Polls CPU or memory usage and triggers when the reading exceeds `threshold`.

| `metric` | Measurement |
|---|---|
| `cpu` | Average CPU usage % across all cores |
| `memory` | Percentage of total RAM currently in use |

```json
{
  "name": "cpu-alert",
  "type": "system",
  "metric": "cpu",
  "threshold": 85,
  "interval": "2m",
  "cooldown": "15m",
  "task": "CPU is at {value}%, above the {threshold}% threshold. What might be causing this?",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

---

## Dangerous tools in monitors

Monitors run headless — there's no human to approve dangerous tools (`write_file`, `run_command`). By default these are **denied**: Goose is told the action was refused and produces a response without executing it.

To allow dangerous tools in monitors, set in `.env`:

```
MONITORS_ALLOW_DANGEROUS=true
```

---

## Example monitor library

### Server health check
```json
{
  "name": "server-health",
  "type": "url",
  "url": "https://example.com/health",
  "interval": "5m",
  "cooldown": "10m",
  "task": "The URL {url} returned {status}. Is this expected? Summarise the situation and check if this is a known issue.",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

### File change watcher
```json
{
  "name": "config-watch",
  "type": "file",
  "path": "path/to/config.json",
  "interval": "1m",
  "cooldown": "5m",
  "task": "The file {path} has changed (modified at {mtime}). Read it and summarise what changed.",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

### High CPU alert
```json
{
  "name": "high-cpu",
  "type": "system",
  "metric": "cpu",
  "threshold": 85,
  "interval": "2m",
  "cooldown": "15m",
  "task": "CPU usage has reached {value}% — above the {threshold}% threshold. What process might be causing this?",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

### High memory alert
```json
{
  "name": "high-memory",
  "type": "system",
  "metric": "memory",
  "threshold": 90,
  "interval": "2m",
  "cooldown": "15m",
  "task": "Memory usage has reached {value}% — above the {threshold}% threshold. Summarise and suggest any immediate actions.",
  "slackChannel": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Monitor never fires | `"enabled": false` | Set to `true` and restart |
| Monitor never fires | Unknown `type` | Check logs for `Unknown monitor type — skipped`; use `url`, `file`, or `system` |
| Fires once then stops | Cooldown is active | Wait for `cooldown` duration to expire, or shorten it |
| `run_command` / `write_file` not executing | Dangerous tools denied | Set `MONITORS_ALLOW_DANGEROUS=true` in `.env` |
| File monitor never triggers | File hasn't changed since first check | The first poll sets the baseline — only subsequent changes trigger |
| URL monitor not firing on 404 | URL redirects to a 2xx page | Ensure the URL returns an error status directly, not a redirect |
| No Slack message | `slackChannel` missing or wrong | Verify channel ID starts with `C`; check logs |
| Monitor not starting | `data/monitors.json` missing | Copy `monitors.example.json` → `data/monitors.json` |

---

## Implementation reference

| File | Role |
|---|---|
| `src/monitors/index.js` | `loadMonitors()`, `startMonitors()`, `stopMonitors()`, `parseInterval()`, `interpolate()` |
| `src/monitors/types/url.js` | URL health check — `check(monitor, state)` |
| `src/monitors/types/file.js` | File mtime poller — `check(monitor, state)` |
| `src/monitors/types/system.js` | CPU/memory poller — `check(monitor)`, `getCpuPercent()`, `getMemoryPercent()` |
| `monitors.example.json` | Committed template — copy to `data/monitors.json` |
| `data/monitors.json` | Runtime config (not committed — in `.gitignore`) |
| `src/index.js` | Calls `startMonitors()` after `startScheduler()` |
| `src/cli.js` | Calls `startMonitors()` in REPL mode only |
| `src/config.js` | `MONITORS_PATH`, `MONITORS_ALLOW_DANGEROUS` |
