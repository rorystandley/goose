# Slack Autonomous Agent — Technical Specification

> **Intent:** This document is a complete technical plan to be executed by an AI coding agent (Claude Code, Cursor, etc.). It defines the project from scratch. The agent should read this fully before writing any code and implement each phase in order.

---

## Implementation Status

**All 8 phases are complete. The bot is running.**

| Phase | Status | Notes |
|---|---|---|
| 1 — Scaffolding | ✅ Done | `package.json`, `.env.example`, `.gitignore`, `src/config.js` |
| 2 — Tools | ✅ Done | All 8 tools implemented across 4 files + `index.js` |
| 3 — Approval Manager | ✅ Done | UUID-keyed, 5-min auto-deny |
| 4 — Memory | ✅ Done | Per-context, 20-message cap |
| 5 — Agent Loop | ✅ Done | Ollama chat, tool dispatch, approval gating |
| 6 — Slack Bot | ✅ Done | Commands, DMs, button interactions |
| 7 — Entry Point | ✅ Done | Startup logging, graceful shutdown |
| 8 — README + Docs | ✅ Done | README + `docs/slack-setup.md` (11-step guide) |

### Post-implementation fixes applied
- **ESM/CJS compatibility** — `@slack/bolt` is CommonJS; changed `import { App } from '@slack/bolt'` to `import pkg from '@slack/bolt'; const { App } = pkg;` in `src/interfaces/slack/bot.js`
- **Slack Messages Tab** — DMs require enabling the Messages Tab in App Home settings (documented in `docs/slack-setup.md` Step 8)
- **`clear memory` match** — replaced exact string `===` check with `/^clear\s+memory$/i` regex in `src/interfaces/slack/messages.js` to handle Slack text delivery quirks

### Actual project structure
```
goose/                          ← renamed from slack-agent/ (agent-first naming)
├── src/
│   ├── index.js
│   ├── config.js
│   ├── agent/                  ← agent core — no interface dependencies
│   │   ├── loop.js
│   │   ├── approvals.js
│   │   └── memory.js
│   ├── tools/                  ← capabilities — no interface dependencies
│   │   ├── web.js
│   │   ├── filesystem.js
│   │   ├── shell.js
│   │   ├── system.js
│   │   └── index.js
│   └── interfaces/             ← pluggable interfaces (Slack is the only one so far)
│       └── slack/              ← moved from src/slack/
│           ├── bot.js
│           ├── commands.js
│           ├── messages.js
│           └── interactions.js
├── docs/
│   ├── slack-setup.md
│   └── tools.md
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Project Overview

Build a personal autonomous agent (Called Goose) that:
- Lives in **Slack** as a bot (triggered via `/agent <task>` slash command or DM)
- Uses a **local Ollama LLM** (Qwen models) for reasoning
- Can use **tools** (web search, file I/O, shell commands, etc.) to complete tasks
- Requires **explicit user approval** in Slack (button click) before executing any dangerous action
- Runs persistently on a **Mac Mini M4** using Socket Mode (no public URL required)

**Primary language:** JavaScript (Node.js, ESM)

---

## Tech Stack

| Layer | Library | Notes |
|---|---|---|
| Slack interface | `@slack/bolt` v3 | Socket Mode — no public URL needed |
| LLM | `ollama` (ollama-js SDK) | Connects to local Ollama instance |
| Runtime | Node.js 20+ | ESM modules (`"type": "module"`) |
| Config | `dotenv` | `.env` file for secrets |
| Validation | `zod` | For tool argument validation |

---

## Project Structure

The agent should scaffold the following structure. Do not deviate from it.

```
slack-agent/
├── src/
│   ├── index.js                  # Entry point — boots the app
│   ├── config.js                 # Centralised config from env vars
│   ├── agent/
│   │   ├── loop.js               # Core agentic loop (LLM ↔ tools)
│   │   ├── approvals.js          # Approval state manager
│   │   └── memory.js             # Conversation memory per channel/user
│   ├── slack/
│   │   ├── bot.js                # Bolt app setup, command/event registration
│   │   ├── commands.js           # /agent slash command handler
│   │   ├── messages.js           # DM message handler
│   │   └── interactions.js       # Button click handlers (approve/deny)
│   └── tools/
│       ├── index.js              # Exports all tools + helper functions
│       ├── web.js                # web_search, fetch_url tools
│       ├── filesystem.js         # read_file, write_file, list_directory tools
│       ├── shell.js              # run_command tool
│       └── system.js             # get_datetime, get_system_info tools
├── .env.example                  # Template — never commit .env
├── .gitignore
├── package.json
└── README.md
```

---

## Environment Variables

Define in `.env` (copy from `.env.example`):

```env
# Slack — from https://api.slack.com/apps
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

# Agent behaviour
AGENT_NAME=Jarvis
MAX_TOOL_ITERATIONS=10
REQUIRE_APPROVAL=true        # Set false to skip approval prompts (not recommended)
ALLOWED_PATHS=/Users         # Comma-separated root paths the agent can read/write
```

---

## Phase 1 — Project Scaffolding ✅ Done

**The agent must complete this phase before any other.**

1. Create `package.json` with `"type": "module"` and the following dependencies:
   - `@slack/bolt`, `ollama`, `dotenv`, `node-fetch`, `zod`
2. Create `.env.example` with all variables from the Environment Variables section above
3. Create `.gitignore` ignoring `node_modules/`, `.env`, `*.log`
4. Create `src/config.js` that imports dotenv and exports a frozen config object built from `process.env`. Throw a clear error on startup if any required variable is missing.
5. Create all directory structure as defined above (empty files are fine at this stage)

---

## Phase 2 — Tool Definitions ✅ Done

All tools live in `src/tools/`. Each tool must conform to this interface:

```js
{
  name: string,           // snake_case identifier
  description: string,   // Natural language — the LLM reads this to decide when to use it
  riskLevel: 'safe' | 'moderate' | 'dangerous',
  parameters: object,    // JSON Schema object describing arguments
  execute: async (args) => string  // Always returns a string result
}
```

### Risk Levels
- `safe` — executes automatically with no user prompt
- `moderate` — executes automatically but logs a warning
- `dangerous` — pauses the agent loop and posts Approve/Deny buttons in Slack; execution only continues after explicit user approval

### Tools to implement

**`src/tools/web.js`**

| Tool | Risk | Description |
|---|---|---|
| `web_search` | safe | Query DuckDuckGo Instant Answer API. No API key needed. Params: `query: string`. Return top results as plain text. |
| `fetch_url` | safe | Fetch a URL, strip HTML tags, truncate to 3000 chars. Params: `url: string`. |

**`src/tools/filesystem.js`**

| Tool | Risk | Description |
|---|---|---|
| `read_file` | safe | Read a file. Resolve path, check existence, return contents. Truncate at 10,000 chars with a notice. Params: `path: string`. |
| `write_file` | dangerous | Write content to a file. Resolve and validate path is within `ALLOWED_PATHS`. Params: `path: string, content: string`. |
| `list_directory` | safe | List files in a directory. Return names, types (file/dir), sizes. Params: `path: string`. |

**`src/tools/shell.js`**

| Tool | Risk | Description |
|---|---|---|
| `run_command` | dangerous | Execute a shell command with `execSync`. 30s timeout. Capture stdout + stderr. Params: `command: string`. Always wrap in try/catch and return error messages rather than throwing. |

**`src/tools/system.js`**

| Tool | Risk | Description |
|---|---|---|
| `get_datetime` | safe | Return current date and time as a readable string. No params. |
| `get_system_info` | safe | Return `os.platform()`, `os.arch()`, `os.totalmem()`, `os.freemem()`, Node version. No params. |

**`src/tools/index.js`** must:
- Import and re-export all tools as a flat array `tools`
- Export a `toolMap` object keyed by tool name for O(1) lookup
- Export `getOllamaToolDefinitions()` that transforms the tools array into Ollama's function calling format:
  ```js
  [{ type: 'function', function: { name, description, parameters } }]
  ```

---

## Phase 3 — Approval Manager ✅ Done

Implement `src/agent/approvals.js`:

- Maintains an in-memory `Map` of pending approvals keyed by a unique ID
- Exports `createApproval({ tool, args })` — returns `{ id, promise }` where `promise` resolves to `true` (approved) or `false` (denied) once the user clicks a Slack button
- Exports `resolveApproval(id, approved: boolean)` — called by the Slack button handler
- Auto-denies any approval not resolved within 5 minutes (use `setTimeout`)
- Exports `hasPending(id)` for safety checks

No external dependencies — pure in-memory state.

---

## Phase 4 — Conversation Memory ✅ Done

Implement `src/agent/memory.js`:

- Stores conversation history per `channelId` or `userId` (for DMs)
- Exports `getHistory(contextId)` — returns the message array for that context
- Exports `addMessage(contextId, message)` — appends a message `{ role, content }`
- Exports `clearHistory(contextId)` — resets a context
- Caps history at **20 messages per context** (drop oldest when exceeded)
- Memory is in-process only (no persistence to disk needed at this stage)

---

## Phase 5 — Agent Loop ✅ Done

Implement `src/agent/loop.js`. This is the core of the project.

### System Prompt

```
You are {AGENT_NAME}, a personal autonomous assistant running locally on the user's machine.
You have access to tools to help complete tasks.
Think step by step. Use tools as needed to gather information or take actions.
Be concise in your final responses.
If a tool fails, try an alternative approach or explain what went wrong.
Today is {current date}.
```

### `runAgent(task, contextId, callbacks)` function

**Arguments:**
- `task: string` — the user's request
- `contextId: string` — channel or user ID for memory scoping
- `callbacks: { onToolCall, onToolResult }` — hooks for the Slack layer

**Behaviour:**

1. Load conversation history for `contextId` from memory
2. Append the new user message to history
3. Send the full message array + tool definitions to Ollama via `ollama.chat()`
4. If the response contains no tool calls: save assistant message to history, return the content string
5. If the response contains tool calls, for each one:
   a. Look up the tool in `toolMap` — if not found, append an error tool result and continue
   b. If `riskLevel === 'dangerous'` and `REQUIRE_APPROVAL === true`: call `callbacks.onToolCall` with `requiresApproval: true` and await the returned promise. If not approved, append a denial message and skip execution.
   c. Otherwise call `callbacks.onToolCall` with `requiresApproval: false` (always returns true)
   d. Execute the tool — wrap in try/catch, always produce a string result
   e. Call `callbacks.onToolResult` with the result
   f. Append the tool result to the message array
6. Loop back to step 3
7. If `MAX_TOOL_ITERATIONS` is reached, return a message telling the user the task was too complex

**Important:** Ollama's chat API with tools uses `role: 'tool'` for tool results. Ensure message format matches exactly what Ollama expects.

---

## Phase 6 — Slack Bot ✅ Done

### `src/slack/bot.js`

- Creates and exports the Bolt `App` instance with `socketMode: true`
- Imports and registers all handlers from `commands.js`, `messages.js`, `interactions.js`
- Does not contain handler logic itself — just wires things up

### `src/slack/commands.js` — `/agent` slash command

**Flow:**
1. Ack immediately (required within 3s)
2. Extract task from `command.text` — return usage hint if empty
3. Post an initial "thinking" message with the task text. Store its `ts` (timestamp) for later updates.
4. Call `runAgent` with the task and a `contextId` of `command.channel_id`
5. Wire up `onToolCall` callback:
   - If `requiresApproval` is false: return true immediately
   - If `requiresApproval` is true: call `createApproval()`, post an approval request message in the thread with Approve/Deny buttons (see Approval Message Format below), await the promise, return the boolean result
6. Wire up `onToolResult` callback: accumulate a tool log array for display
7. On completion: post the final result in the thread; update the original "thinking" message to show it's done
8. On error: post the error message in the thread

**Approval Message Format** (posted in thread):
```
⚠️ *{AGENT_NAME} wants to run `{toolName}`*
```{args as formatted JSON}```
[✅ Approve]  [❌ Deny]
```
Buttons must carry the `approvalId` as their `value`.

### `src/slack/messages.js` — DM handler

- Listen for `message` events where `channel_type === 'im'`
- Ignore messages from bots (`message.bot_id` check)
- Run the agent with `contextId` set to `message.user`
- For DMs: auto-approve safe and moderate tools; only prompt for dangerous ones (same approval flow, posted in the DM)
- Support the command `clear memory` — call `clearHistory(message.user)` and confirm

### `src/slack/interactions.js` — Button handlers

- Register action handler for action ID `approve_tool`
- Register action handler for action ID `deny_tool`
- Both must `ack()` immediately
- Extract `approvalId` from `body.actions[0].value`
- Call `resolveApproval(approvalId, true/false)`
- Update the approval message in Slack to reflect the decision (replace buttons with a status line)

---

## Phase 7 — Entry Point ✅ Done

Implement `src/index.js`:

1. Import config — this will throw if env vars are missing
2. Log startup info: agent name, model, Ollama host
3. Create and start the Slack app
4. Log confirmation that the bot is online
5. Handle `SIGTERM` and `SIGINT` for graceful shutdown

---

## Phase 8 — README + Docs ✅ Done

Write a `README.md` that covers:

1. **What it is** — one paragraph
2. **Slack App Setup** — step by step: create app, enable Socket Mode, generate app token, add bot scopes, install to workspace, create `/agent` slash command, enable DM events. Be specific about which scopes are needed.
3. **Required Slack Bot Scopes:** `chat:write`, `commands`, `im:history`, `im:read`, `im:write`
4. **Required Slack Event Subscriptions:** `message.im`
5. **Installation:** `npm install`, copy `.env.example` to `.env`, fill in values
6. **Running:** `npm run dev` and `npm start`
7. **Usage examples** — at least 5 example `/agent` commands covering different tool types
8. **Adding a new tool** — code example showing the tool interface
9. **Risk levels table** — what each level means and how it behaves

---

## Coding Standards

The agent must follow these throughout:

- **ESM only** — use `import`/`export`, never `require()`
- **Async/await** — no raw promise chains
- **Error handling** — all tool `execute()` functions must catch errors and return them as strings rather than throwing; the agent loop must not crash on tool errors
- **No hardcoded secrets** — everything via `process.env` through `config.js`
- **Descriptive tool descriptions** — the LLM reads these; write them clearly in plain English
- **Comments on non-obvious logic** — particularly in `loop.js` and `approvals.js`

---

## What Not to Build (Out of Scope for v1)

- No database or persistent storage
- No multi-workspace support
- No web UI or dashboard
- No Docker / deployment config
- No scheduled tasks or cron
- No plugin system

These can be added in future iterations.

---

## Done Criteria

- [x] `npm install && npm start` boots without errors (assuming valid `.env`) — **confirmed working**
- [x] `/agent what time is it?` responds correctly in Slack — **confirmed working**
- [x] `/agent search the web for latest news on Anthropic` returns search results — **confirmed working** (Serper)
- [x] `/agent run the command: echo hello world` triggers an Approve/Deny prompt before executing — **confirmed working**
- [x] Clicking Approve runs the command and returns output — **confirmed working**
- [x] Clicking Deny skips the command and the agent responds accordingly — **confirmed working**
- [x] DM-ing the bot works for simple questions — **confirmed working** *(required Messages Tab to be enabled in Slack App Home — see `docs/slack-setup.md` Step 8)*
- [x] `clear memory` in a DM resets conversation history — **confirmed working** *(fixed: exact string match replaced with regex `/^clear\s+memory$/i` to handle Slack text delivery quirks)*
- [x] All files are in the correct locations as per the project structure
