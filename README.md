# Goose

<p align="center">
  <a href="https://github.com/rorystandley/goose/actions/workflows/ci.yml">
    <img src="https://github.com/rorystandley/goose/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <img src="https://img.shields.io/badge/node-20-339933?logo=node.js&logoColor=white" alt="Node 20" />
  <img src="https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Frorystandley%2Fgoose%2Fdevelop%2Fdocs%2Fassets%2Fcoverage-badge.json" alt="Coverage" />
  <img src="https://img.shields.io/badge/llm-ollama-black" alt="Ollama" />
</p>

<p align="center">
  <img src="docs/assets/goose.png" alt="Goose" width="200"/>
</p>

<p align="center">
  <em>"Talk to me, Goose." — Your personal AI wingman. Local LLM, no cloud, fully yours.</em>
</p>

---

Goose is a personal autonomous agent powered by a local Ollama LLM. It reasons step by step, uses tools (web search, file I/O, shell commands), and asks for your approval before executing anything risky, all without sending your data to the cloud.

Whether it's searching the web, running shell commands, or navigating your file system, Goose executes with precision and checks in before anything risky, just like any good wingman would. Every mission runs on your own hardware: no data leaves your network, no cloud sees your prompts, and no subscription stands between you and the objective.

**Two interfaces are currently live: Slack and CLI.** Goose is not a Slack bot or a CLI tool, it's an agent. Each interface is a thin adapter that calls `runAgent()`. New interfaces can be added without touching the agent core.

---

## Architecture

```
goose/
  src/
    agent/              ← the brain — no interface dependencies
      loop.js           ← agentic reasoning loop
      memory.js         ← per-context conversation history (sliding window)
      facts.js          ← permanent fact store (cross-context, never expires)
      approvals.js      ← approval gate (interface-agnostic)
    tools/              ← capabilities — no interface dependencies
      web.js            ← web_search, fetch_url
      filesystem.js     ← read_file, write_file, list_directory
      shell.js          ← run_command
      system.js         ← get_datetime, get_system_info
      reflect.js        ← record_thought (thought journal)
      facts.js          ← remember_fact (permanent fact store)
      index.js          ← tool registry
    scheduler/
      index.js          ← cron scheduler — fires missions from data/missions.json
    interfaces/
      slack/            ← Slack interface
        bot.js
        commands.js     ← /goose slash command
        messages.js     ← DM handler
        interactions.js ← Approve/Deny buttons
      cli/              ← CLI interface
        index.js        ← interactive REPL + one-shot mode
    config.js
    index.js            ← Slack entry point  (npm start)
    cli.js              ← CLI entry point    (npm run cli)
```

The agent core (`src/agent/`, `src/tools/`) has zero dependencies on any interface. Adding a new interface means adding a new folder under `src/interfaces/` and calling `runAgent()`.

---

## Documentation

| Guide | Description |
|---|---|
| [docs/slack-setup.md](docs/slack-setup.md) | Step-by-step Slack app setup |
| [docs/tools.md](docs/tools.md) | All tools, parameters, risk levels, and search provider setup |
| [docs/memory.md](docs/memory.md) | How memory works — sliding window, context IDs, long-term fact store |
| [docs/missions.md](docs/missions.md) | Scheduled missions — field reference, cron syntax, and example library |

---

## Contributing

Contributions are welcome.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and PR expectations
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards
- See [SECURITY.md](SECURITY.md) for responsible vulnerability disclosure
- Project license: [MIT](LICENSE)

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

**Slack interface**
```bash
npm start          # production
npm run dev        # development (auto-restarts on file changes)
```
Connects via WebSocket, no public URL or ngrok needed.

**pm2 (Production — persistent, survives reboots)**
```bash
pm2 start ecosystem.config.cjs   # start Goose and register it with pm2
pm2 save                          # persist the process list across reboots
pm2 startup                       # generate a startup script (run the command it prints)
pm2 logs goose                    # tail live logs
pm2 restart goose                 # after config or code changes
pm2 status                        # uptime, restart count, memory
```
`ecosystem.config.cjs` is committed to the repo. pm2 auto-restarts Goose on crash (e.g. Slack socket disconnects) with a 3-second delay and a max of 10 restarts.

**CLI interface**
```bash
npm run cli                              # interactive REPL
npm run cli -- "summarise ~/Downloads"   # one-shot (runs task, exits)
```
No Slack account required. Memory persists across CLI sessions per machine.

---

## Slack Interface Setup

See **[docs/slack-setup.md](docs/slack-setup.md)** for the full step-by-step guide, including:
- Creating the app and enabling Socket Mode
- Required bot scopes and event subscriptions
- Enabling DMs (Messages Tab is easy to miss!)
- Filling in `.env`
- Verification checklist and troubleshooting

---

## Usage Examples

```
/goose help
```
Shows the live tool list, always up to date, no docs required.

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

### CLI

```bash
npm run cli
```
Opens the interactive REPL:
```
🪿 goose> what time is it?
🪿 goose> list my downloads
🪿 goose> run the command: df -h
🪿 goose> clear memory
🪿 goose> exit
```

One-shot mode (runs the task and exits — great for scripting):
```bash
npm run cli -- "summarise ~/Downloads"
npm run cli -- "what is the weather in London today?"
npm run cli -- "read ~/notes.txt and give me a summary"
```

Dangerous tools (`write_file`, `run_command`) pause for inline approval:
```
🔴 Dangerous tool: run_command
{"command":"rm -rf /tmp/old"}
Approve? [y/N]:
```

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

That's it, the agent loop and Ollama tool definitions pick it up automatically.

---

## Adding a New Interface

Create `src/interfaces/<name>/` and implement an entry point that:
1. Receives input from the user
2. Calls `runAgent(task, contextId, { onToolCall, onToolResult })` from `src/agent/loop.js`
3. Sends the returned string back to the user
4. Handles the approval flow via `createApproval()` / `resolveApproval()` from `src/agent/approvals.js`

No changes to `src/agent/` or `src/tools/` required.

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
| `MEMORY_PATH` | | `data/memory.json` | Where conversation memory is persisted — see [docs/memory.md](docs/memory.md) |
| `FACTS_PATH` | | `data/facts.json` | Permanent fact store — key-value facts injected into every prompt — see [docs/memory.md](docs/memory.md#long-term-memory--fact-store) |
| `THOUGHTS_PATH` | | `data/thoughts.jsonl` | Thought journal — append-only JSONL written by `record_thought` |
| `MISSIONS_PATH` | | `data/missions.json` | Scheduled missions config — see [docs/missions.md](docs/missions.md) |
| `SCHEDULER_ALLOW_DANGEROUS` | | `false` | Allow `write_file`/`run_command` in scheduled missions |
| `BRAVE_SEARCH_API_KEY` | | — | Brave Search API key (paid) |
| `SERPER_API_KEY` | | — | Serper API key (2,500 free Google results) |
| `TAVILY_API_KEY` | | — | Tavily API key (1,000 free req/month) |

Add **at least one** search key to enable `web_search`. See [docs/tools.md](docs/tools.md#search-providers) for details.
