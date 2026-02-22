# Goose

<p align="center">
  <img src="docs/assets/goose.png" alt="Goose" width="200"/>
</p>

<p align="center">
  <em>"Talk to me, Goose." — Your personal AI wingman. Local LLM, no cloud, fully yours.</em>
</p>

---

Goose is a personal autonomous agent powered by a local Ollama LLM. It reasons step by step, uses tools (web search, file I/O, shell commands), and asks for your approval before executing anything risky — all without sending your data to the cloud.

Whether it's searching the web, running shell commands, or navigating your file system, Goose executes with precision and checks in before anything risky — just like any good wingman would. Every mission runs on your own hardware: no data leaves your network, no cloud sees your prompts, and no subscription stands between you and the objective.

**Slack is the current interface.** Goose is not a Slack bot — it's an agent that happens to be reachable through Slack right now. Other interfaces (CLI, HTTP API, etc.) can be added without touching the agent core.

---

## Architecture

```
goose/
  src/
    agent/              ← the brain — no interface dependencies
      loop.js           ← agentic reasoning loop
      memory.js         ← per-context conversation history
      approvals.js      ← approval gate (interface-agnostic)
    tools/              ← capabilities — no interface dependencies
      web.js            ← web_search, fetch_url
      filesystem.js     ← read_file, write_file, list_directory
      shell.js          ← run_command
      system.js         ← get_datetime, get_system_info
      index.js          ← tool registry
    interfaces/
      slack/            ← one way to talk to Goose
        bot.js
        commands.js     ← /goose slash command
        messages.js     ← DM handler
        interactions.js ← Approve/Deny buttons
    config.js
    index.js            ← entry point (currently starts Slack interface)
```

The agent core (`src/goose/`, `src/tools/`) has zero dependencies on any interface. Adding a new interface means adding a new folder under `src/interfaces/` and calling `runAgent()`.

---

## Documentation

| Guide | Description |
|---|---|
| [docs/slack-setup.md](docs/slack-setup.md) | Step-by-step Slack app setup |
| [docs/tools.md](docs/tools.md) | All tools, parameters, risk levels, and search provider setup |

---

## Installation

```bash
git clone <repo>
cd goose
npm install
cp .env.example .env
# Edit .env — Slack tokens, Ollama config, and at least one search API key
```

---

## Running

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Connects via WebSocket — no public URL or ngrok needed.

---

## Slack Interface Setup

See **[docs/slack-setup.md](docs/slack-setup.md)** for the full step-by-step guide, including:
- Creating the app and enabling Socket Mode
- Required bot scopes and event subscriptions
- Enabling DMs (Messages Tab — easy to miss!)
- Filling in `.env`
- Verification checklist and troubleshooting

---

## Usage Examples

```
/goose help
```
Shows the live tool list — always up to date, no docs required.

```
/goose what time is it?
```
```
/goose search the web for the latest news on Anthropic
```
```
/goose run the command: df -h
```
```
/goose read the file /Users/me/notes.txt and summarise it
```
```
/goose list the files in /Users/me/Downloads
```

You can also DM Goose directly for a more conversational experience. Type `clear memory` in a DM to reset conversation history.

---

## Risk Levels

Before any tool runs, the agent checks its risk level:

| Level | Behaviour | Examples |
|---|---|---|
| `safe` | Executes automatically | `web_search`, `fetch_url`, `read_file`, `list_directory`, `get_datetime`, `get_system_info` |
| `moderate` | Executes automatically, logs a warning | *(none currently)* |
| `dangerous` | Pauses and posts Approve/Deny buttons | `write_file`, `run_command` |

Set `REQUIRE_APPROVAL=false` in `.env` to skip approval prompts (not recommended).

---

## Adding a New Tool

Create or add to a file in `src/tools/`. Every tool must conform to this interface:

```js
export const my_tool = {
  name: 'my_tool',
  description: 'Describe what this tool does. The LLM reads this.',
  riskLevel: 'safe', // 'safe' | 'moderate' | 'dangerous'
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The input value' },
    },
    required: ['input'],
  },
  execute: async ({ input }) => {
    try {
      return `Result: ${input}`;
    } catch (err) {
      return `Error: ${err.message}`; // always return a string, never throw
    }
  },
};
```

Then register it in `src/tools/index.js`:

```js
import { my_tool } from './example.js';
export const tools = [ ...existingTools, my_tool ];
```

That's it — the agent loop and Ollama tool definitions pick it up automatically.

---

## Adding a New Interface

Create `src/interfaces/<name>/` and implement an entry point that:
1. Receives input from the user
2. Calls `runAgent(task, contextId, { onToolCall, onToolResult })` from `src/goose/loop.js`
3. Sends the returned string back to the user
4. Handles the approval flow via `createApproval()` / `resolveApproval()` from `src/goose/approvals.js`

No changes to `src/goose/` or `src/tools/` required.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | — | Bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | ✅ | — | App-level token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | ✅ | — | From Basic Information in Slack app settings |
| `OLLAMA_HOST` | | `http://localhost:11434` | URL of your local Ollama instance |
| `OLLAMA_MODEL` | | `qwen2.5:14b` | Ollama model to use |
| `AGENT_NAME` | | `Goose` | Name shown in responses |
| `MAX_TOOL_ITERATIONS` | | `10` | Max tool calls per task before giving up |
| `REQUIRE_APPROVAL` | | `true` | Whether dangerous tools need approval |
| `ALLOWED_PATHS` | | `/Users` | Comma-separated paths writable by the agent |
| `BRAVE_SEARCH_API_KEY` | | — | Brave Search API key (paid) |
| `SERPER_API_KEY` | | — | Serper API key (2,500 free Google results) |
| `TAVILY_API_KEY` | | — | Tavily API key (1,000 free req/month) |

Add **at least one** search key to enable `web_search`. See [docs/tools.md](docs/tools.md#search-providers) for details.
