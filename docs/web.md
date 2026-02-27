# Goose — Web UI Dashboard

The web dashboard gives you a browser window into Goose — live chat, a real-time stream of every tool call as it happens, inline Approve/Deny buttons for dangerous tools, and a memory inspector showing exactly what Goose remembers about each context. It runs as a local HTTP server alongside Slack and the CLI; the agent core never knows the UI exists.

---

## Quick start

```bash
# 1. Start Goose with the web UI enabled
npm run web

# 2. Open the dashboard in your browser
open http://localhost:3000
```

That's it. `npm run web` is shorthand for `WEB_ENABLED=true node src/cli.js` — the CLI REPL and the web dashboard both start together. You can use either to talk to Goose; they share the same memory.

---

## Configuration

| Field | Env var | Default | Description |
|---|---|---|---|
| Enable web UI | `WEB_ENABLED` | `false` | Set to `true` to start the HTTP server |
| Port | `WEB_PORT` | `3000` | Port the server binds to (127.0.0.1 only) |

Add to your `.env`:

```
WEB_ENABLED=true
WEB_PORT=3000
```

Or pass inline for a one-off start:

```bash
WEB_ENABLED=true WEB_PORT=8080 npm run cli
```

The server always binds to `127.0.0.1` — it is never accessible from the network.

---

## Context ID

Every browser session gets a stable **context ID** (e.g. `web-a3f7c2d1`) generated on first visit and persisted in `localStorage`. This is the key that scopes all memory and conversation history.

- **Same tab, different days** — same context ID, Goose remembers the conversation
- **New incognito tab** — new context ID, fresh memory
- **Switching to the CLI** — the CLI uses `cli-<hostname>` as its context ID; the web and CLI don't share memory by default

To use a different context ID, clear `localStorage` in your browser's developer tools or use the memory panel's context selector to switch to an existing context.

---

## UI panels

### Main panel (left)

The main panel is a unified **timeline** — user messages, assistant responses, and tool call cards all appear in the same scrolling view in the order they happened.

**Sending a message**: Type in the input bar at the bottom and press `Enter` (or `Shift+Enter` for a new line). The send button disables while the agent is running and re-enables when the response arrives.

**Thinking indicator**: Three animated dots appear while Goose is working, then disappear when the response lands.

### Memory inspector (right sidebar)

The sidebar shows the raw conversation history stored in `data/memory.json` for the selected context.

- **Context selector** — drop-down showing all context IDs with stored history. Auto-selects your current session's context ID on load.
- **Refresh** — re-fetches history from disk (useful after a scheduled mission writes to a context)
- **Clear** — deletes all stored messages for the selected context (same as `clear memory` in the REPL)

---

## Tool call stream

Every tool call the agent makes appears as a **tool card** in the timeline before the final response.

Each card shows:
- **Tool name** in blue monospace
- **Risk badge** — colour-coded: `Safe` (green), `Moderate` (yellow), `Dangerous` (red)
- **Arguments** — collapsed by default; click "▼ Show more" to expand if the args are long

When the tool finishes, its result appears below the args (truncated to 500 chars for display; the full result is always passed back to the model).

---

## Approval flow

When Goose needs to run a **dangerous tool** (`write_file`, `remember_fact`, `run_command`), the agent loop pauses and an **approval card** appears in the timeline:

```
⚠️  Dangerous tool: write_file
──────────────────────────────
{
  "path": "/Users/you/notes.md",
  "content": "…"
}

[ ✓ Approve ]  [ ✕ Deny ]
```

- **Approve** — the tool executes, the agent continues
- **Deny** — the tool is skipped; the agent receives a "denied" message and decides what to do next (usually explains it can't proceed)
- Both buttons disable after clicking and show a confirmation label

The approval times out automatically after 5 minutes (same as Slack). If you close the tab while an approval is pending, it will be auto-denied when the timeout expires.

---

## Memory inspector

The memory inspector shows the raw `{ role, content }` message array for the selected context — exactly what gets sent to the LLM on the next turn, minus the system prompt and facts.

Each entry is labelled `user` (orange) or `assistant` (blue) and shows a truncated preview of the content. This is useful for debugging why Goose responded a certain way or for checking what it currently remembers.

**Clearing memory** from the web UI does the same thing as typing `clear memory` in the REPL — it deletes the conversation history for that context but leaves long-term facts (`data/facts.json`) untouched.

---

## API reference

All endpoints are served by the local HTTP server. Base URL: `http://localhost:3000`

| Method | Path | Request body | Response | Description |
|---|---|---|---|---|
| `GET` | `/` | — | `200 text/html` | Serve the dashboard |
| `GET` | `/api/events` | `?contextId=<id>` | `200 text/event-stream` | Open SSE stream |
| `POST` | `/api/chat` | `{ task, contextId }` | `202 { contextId }` | Run the agent (async) |
| `POST` | `/api/approve` | `{ approvalId, contextId }` | `200 {}` | Approve a pending tool |
| `POST` | `/api/deny` | `{ approvalId, contextId }` | `200 {}` | Deny a pending tool |
| `GET` | `/api/memory` | `?contextId=<id>` | `200 { contextId, messages }` | Get conversation history |
| `DELETE` | `/api/memory` | `?contextId=<id>` | `200 {}` | Clear conversation history |
| `GET` | `/api/contexts` | — | `200 { contextIds }` | List all context IDs |

**`POST /api/chat` is fire-and-forget.** It returns `202` immediately and the result flows back via the SSE stream — the browser doesn't need to poll. Always open the `/api/events` stream before sending a chat request.

Error responses always return `{ error: string }` with an appropriate 4xx/5xx status.

---

## SSE events

The `/api/events` stream delivers five event types. Each event is scoped to the `contextId` passed in the query string — only events for that context are delivered.

| Event | Payload | When |
|---|---|---|
| `toolCall` | `{ toolName, args, requiresApproval, riskLevel, approvalId? }` | Agent calls a tool |
| `toolResult` | `{ toolName, result }` | Tool finishes (result truncated to 500 chars) |
| `agentResponse` | `{ content }` | Agent loop completes, final text response |
| `agentError` | `{ message }` | Agent loop threw an error |
| `approvalResolved` | `{ approvalId, approved }` | User clicked Approve or Deny |

`toolCall` with `requiresApproval: true` also includes `approvalId` — the browser uses this to match the Approve/Deny POST request back to the right pending tool.

Subscribe in vanilla JS:

```js
const es = new EventSource('/api/events?contextId=' + contextId);
es.addEventListener('agentResponse', e => {
  const { content } = JSON.parse(e.data);
  console.log('Goose says:', content);
});
```

---

## Running alongside Slack

The web UI can run at the same time as the Slack bot. Set `WEB_ENABLED=true` in your `.env` and start normally:

```bash
# Slack + Web UI (npm start calls src/index.js)
WEB_ENABLED=true npm start

# or add to .env permanently:
echo "WEB_ENABLED=true" >> .env
npm start
```

The Slack bot and web UI share the same memory store and tool registry. A context learned via Slack (e.g. `C0123ABC`) is visible in the web memory inspector; a `remember_fact` called from the web UI is available in every Slack DM.

---

## Implementation reference

| File | Role |
|---|---|
| `src/interfaces/web/server.js` | HTTP server lifecycle — `startWebServer()`, `stopWebServer()` |
| `src/interfaces/web/handlers.js` | Route handler for all 8 endpoints |
| `src/interfaces/web/sse.js` | SSE connection pool — `addClient`, `removeClient`, `write` |
| `src/interfaces/web/callbacks.js` | `makeCallbacks(contextId)` — wires `runAgent` hooks to SSE |
| `src/interfaces/web/public.js` | `getHtml(agentName, model)` — complete HTML/CSS/JS dashboard string |
