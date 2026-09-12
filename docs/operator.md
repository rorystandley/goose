# Operator (Ops tab)

The Ops tab is a mission-operator dashboard in the web UI that surfaces what Goose is doing across all channels — audio briefings, scheduled missions, monitors, and installed plugins — in one place.

It joins the existing **Chat** and **Kanban** tabs at `http://localhost:3000/` (when `WEB_ENABLED=true`).

## Why it exists

Goose's voice interface (and the MLX TTS Studio backend) can generate spoken briefings — daily summaries, mission reports, monitor alerts — but those audio files only play on the machine that produced them. If you're away from your desk when the briefing fires, you miss it. The Ops tab lets you replay or delete past briefings from any device that can reach the web UI, with full attribution (which mission, which voice, what was said).

It also gives a unified at-a-glance view of mission schedules, monitor health, and the plugin surface, so you can see Goose's "instrument cluster" without diving through `data/*.json` files or `pm2 logs`.

## Tiles

### System (top strip)

Read-only stats: agent callsign, model, TTS backend, live uptime, whether `AUDIO_OUTPUT_DIRS` is configured. Uptime ticks in real time while the tab is open.

### Audio Library

Lists every generated audio briefing newest-first. Each row shows:

- **Source badge** — `MISSION`, `MONITOR`, `VOICE`, or `AD-HOC` (colour-coded)
- **Attribution** — mission/monitor name or context id
- **When + duration** — relative timestamp, length in seconds
- **Transcript preview** — the exact text that was spoken (truncated to two lines)
- **Play (▶)** — streams via `/api/audio/:id/stream`. A shared `<audio>` player at the top of the tile handles playback; the active row is highlighted.
- **Delete (✕)** — removes the manifest entry **and** unlinks the file (tolerant of already-missing files).

Entries whose file has been removed from disk are greyed out with a `(file removed)` flag. If `AUDIO_OUTPUT_DIRS` is not configured, rows show `(AUDIO_OUTPUT_DIRS not configured — cannot play)` instead of a play button — the security model requires an allowlist of directories Goose may read from.

### Missions

Read-only list of every mission in `data/missions.json`, joined with runtime state:

- **Status LED** — green (idle/completed), pulsing orange (running), red (failed)
- **Schedule** — raw cron expression + timezone
- **Last run** — relative timestamp + duration
- **Next run** — computed live from the cron expression
- **Trigger button** — manually invokes the mission via `POST /api/missions/:name/trigger`. The same `executeMission()` function the scheduler uses, with `source: 'manual'`. Disabled while a mission is `running`.

Tags surface mission shape: `PHASED` for multi-phase, `DIRECT` for tool-only (no LLM), `DISABLED` for `enabled: false` missions.

### Monitors

Read-only list of every monitor in `data/monitors.json` with live status from the polling loop:

- **Status LED** — green (ok), orange (cooldown), red (triggered/failed)
- **Type / target** — `URL`, `SYSTEM`, or `FILE`, plus the watched URL or metric
- **Interval + cooldown**
- **Last check** — relative timestamp
- **Current value** — for system monitors (e.g. `value=42 percent=42`), with the configured threshold

Updates arrive over SSE — no polling from the browser.

### Plugin tiles

Installed plugins may export `tiles` that render on the Overview as live command-centre panels (for example crypto watchlist prices). Tile metadata is listed under Loadout; payloads refresh on each tile’s interval via `/api/tiles/data`.

### Plugins

Collapsible groups for every loaded plugin:

- **Group header** — `packageName vVERSION` + source badge (`npm` or `local`) + tool count
- **Description** (if package.json provides one)
- **Tool list** — each tool's name, risk-level badge (safe/moderate/dangerous), and one-line description

Local plugins without a `package.json` show `—` for version. Plugins that throw on import are still listed, with a `Load error: ...` line so the failure is visible.

## Configuration

Add to `.env`:

```env
# Where to write the audio manifest (default: ./data/audio.json)
AUDIO_PATH=./data/audio.json

# Comma-separated allowlist of directories Goose is allowed to read/unlink
# audio files from. REQUIRED for audio playback in the Ops tab — without it,
# the manifest still tracks new files but the streaming endpoint refuses to
# serve them.
AUDIO_OUTPUT_DIRS=/Users/you/Apps/mlx-tts-studio/outputs
```

`AUDIO_OUTPUT_DIRS` accepts multiple comma-separated directories. Each is resolved to its real path (symlinks followed) at startup; only files whose real path resolves inside one of these roots will stream or delete.

## Audio manifest schema

The audio manifest at `data/audio.json` is written by `src/audio/store.js` whenever `tts.js` successfully synthesises a TTS file. Schema:

```json
{
  "audio": [
    {
      "id": "01HXYZ...",
      "path": "/Users/.../outputs/1776706777-mlx-community-kokoro-82m-bf16.wav",
      "filename": "1776706777-mlx-community-kokoro-82m-bf16.wav",
      "createdAt": "2026-05-17T08:00:00.000Z",
      "text": "Good morning. Your briefing for today...",
      "source": "mission",
      "missionName": "morning-briefing",
      "monitorName": null,
      "contextId": "mission-morning-briefing",
      "model": "mlx-community/Kokoro-82M-bf16",
      "voice": "af_heart",
      "duration": 32.5,
      "format": "wav"
    }
  ]
}
```

| Field         | Description |
|---------------|-------------|
| `id`          | Generated UUID v4 — used by API endpoints. Never derived from path (so renaming on disk doesn't break links). |
| `path`        | Absolute path returned by MLX TTS Studio's `/synthesize` endpoint. |
| `createdAt`   | ISO timestamp at synthesis. |
| `text`        | Exact text that was spoken — used as the transcript preview. |
| `source`      | One of `mission` / `monitor` / `voice` / `ad-hoc`. Drives the source badge. |
| `missionName` / `monitorName` / `contextId` | Attribution — at most one of mission/monitor is non-null per entry. |
| `model` / `voice` / `duration` | From the MLX `/synthesize` response. |
| `format`      | Audio format (typically `wav`). Drives the Content-Type for streaming. |

Writes are serialised through a single-flight promise chain in `src/audio/store.js` to prevent races when missions, monitors, and voice REPL all speak at once.

## Security model

Audio files live outside the Goose repo (in MLX TTS Studio's output dir, by default `~/Apps/mlx-tts-studio/outputs/`). Streaming and deleting them therefore has to be gated.

The model: **never accept a path from the client**. The browser only ever sends a manifest `id`. The server:

1. Looks up the entry by id in `data/audio.json`
2. Calls `fs.realpathSync(entry.path)` (follows symlinks)
3. Checks `path.relative(root, realPath)` against each configured `AUDIO_OUTPUT_DIRS` root — the relative result must not be absolute and must not start with `..`
4. Only then opens the file for read/unlink

If `AUDIO_OUTPUT_DIRS` is empty, no files are servable. The audio manifest is still useful (transcript archive) but the play/delete buttons are inert.

## SSE events

The Ops tab subscribes to these broadcast events:

- `audioCreated` — payload: the new manifest entry. Fired when `tts.js` writes a new file.
- `audioDeleted` — payload: `{ id }`. Fired when `/api/audio/:id` DELETE succeeds.
- `missionStateChanged` — payload: `{ name, status, lastRun, lastError, lastDuration, ... }`. Fired on every state transition (start/complete/fail).
- `monitorStateChanged` — payload: `{ name, status, lastCheck, lastValue, lastTrigger, ... }`. Fired on each monitor poll tick or cooldown/trigger.

The tile re-renders only when the Ops tab is currently visible — state is updated in memory either way.

## Empty states

Every tile renders cleanly when its data source is absent:

- **MLX TTS Studio offline** → no audio entries appear, Audio Library shows "No audio briefings yet". Mission speech still works via macOS `say` fallback (no files generated, no manifest entries).
- **Empty `data/missions.json`** → Missions tile shows "No missions configured".
- **Empty `data/monitors.json`** → Monitors tile shows "No monitors configured".
- **No `@goose-plugins/*` installed** → Plugins tile shows only local plugins (or the empty hint).
- **`AUDIO_OUTPUT_DIRS` unset** → manifest still records new audio (so attribution is preserved); play/delete are disabled with a clear flag.

## HTTP API

| Method | Path                              | Returns                                                             |
|--------|-----------------------------------|---------------------------------------------------------------------|
| GET    | `/api/system`                     | `{ agentName, model, ttsBackend, uptime, audioOutputDirsConfigured, ... }` |
| GET    | `/api/audio`                      | `{ audio: [{ ...entry, missing, playable }] }` newest first         |
| GET    | `/api/audio/:id/stream`           | Audio bytes (Content-Type from manifest format)                     |
| DELETE | `/api/audio/:id`                  | `{}` (broadcasts `audioDeleted`)                                    |
| GET    | `/api/missions`                   | `{ missions: [{ ...config, status, lastRun, nextRun }] }`           |
| POST   | `/api/missions/:name/trigger`     | `202 { name, status: "triggered" }` — fire-and-forget               |
| GET    | `/api/monitors`                   | `{ monitors: [{ ...config, status, lastCheck, lastTrigger }] }`     |
| GET    | `/api/plugins`                    | `{ plugins: [{ source, packageName, version, tools }] }`            |

## File layout

```
src/
├── audio/
│   └── store.js               # manifest CRUD with serialised writes
├── scheduler/
│   ├── index.js               # executeMission() factored out for reuse
│   └── state.js               # in-memory mission state + broadcast
├── monitors/
│   └── index.js               # getMonitorStates() + setMonitorState()
├── plugins/
│   ├── index.js               # (unchanged) tool loader
│   └── metadata.js            # read-only plugin enumeration for the UI
├── interfaces/
│   ├── voice/
│   │   ├── tts.js             # speak(text, context) — records manifest entry on MLX synth
│   │   └── index.js           # passes voice context attribution
│   └── web/
│       ├── handlers.js        # new routes + static asset serving for /app.{css,js}
│       ├── public.js          # HTML shell only — links /app.css and /app.js
│       └── static/
│           ├── app.css        # extracted CSS + Ops/HUD additions
│           └── app.js         # extracted JS + Ops tab logic + SSE handlers
docs/
└── operator.md                # this file
data/
└── audio.json                 # manifest (created on first synthesis)
```

## Future enhancements

Deferred from the initial Ops tab implementation. Each is intentionally out of scope for v1; pull requests welcome.

- **Range request support for audio streaming** — current implementation sends full-body with `Accept-Ranges: none`. Fine for short (~30s) TTS briefings; revisit if longer audio becomes common.
- **Backfill existing audio files** — audio generated before this lands won't appear in the library (no transcript/source attribution available). One-time scan with placeholder metadata was considered and rejected as misleading.
- **Mission editing/creation from UI** — `data/missions.json` remains the source of truth. A read-only mission view was chosen for v1 to keep blast radius small.
- **Plugin install/remove from UI** — would require npm install execution from a web request; defer until trust model is designed.
- **Voice recording from browser** — would let users issue voice commands without a terminal. Requires MediaRecorder + WebRTC + transcription endpoint.
- **Per-tab JS module split** — `src/interfaces/web/static/app.js` is monolithic. If it grows past ~150KB, split into `app.js` + `chat.js` + `kanban.js` + `ops.js` browser modules.
- **HUD animation upgrades** — radar sweep, waveform visualizer on playing audio, ATC-style scrolling feeds. Subtle HUD was chosen for v1; flashier aesthetic can come later.
- **Mission run history** — only the most recent run state is kept in-memory. A `data/mission-runs.jsonl` append-only log would enable trend analysis (run frequency, failure rate, average duration).
