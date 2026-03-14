# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Goose is a personal autonomous AI agent powered by a local Ollama LLM. It runs entirely on-device with multiple interfaces (Slack, CLI, Web, Voice). The codebase uses ES Modules (`"type": "module"`) throughout.

## Commands

```bash
# Development
npm run dev          # Slack interface with auto-restart
npm run cli          # CLI interface (interactive REPL)
npm run dev:web      # Web UI with auto-restart
npm run dev:voice    # Voice interface with auto-restart

# Testing
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report (thresholds: 70% lines, 75% functions, 60% branches)

# Run a single test file
npx vitest run src/__tests__/agent/loop.test.js

# Production (PM2)
pm2 start ecosystem.config.cjs   # Starts main agent + scheduler
```

## Architecture

**Core principle**: The agent core has zero interface dependencies. All interfaces call `runAgent()` from `src/agent/loop.js`. Adding a new interface requires only a new folder under `src/interfaces/`.

### Agent Loop (`src/agent/loop.js`)

1. Build system prompt (injects agent name, date, facts, memory)
2. Load conversation history for `contextId` (sliding window, max 20 messages)
3. Select model via router (`src/agent/router.js`)
4. Call Ollama API with tool definitions
5. **Tool execution loop** (up to `MAX_TOOL_ITERATIONS`):
   - Dangerous tools → pause and request approval via `src/agent/approvals.js`
   - Execute tool, append result, re-call LLM
6. Persist updated memory

### Approval Gate (`src/agent/approvals.js`)

When a dangerous tool is requested, the loop calls `onToolCall()` which is an interface-provided callback. Each interface implements its own approval UI (Slack buttons, CLI prompt). Approvals expire after 5 minutes (auto-deny). After denial, the LLM gets one final call without tools.

### Memory System

- **Sliding window** (`src/agent/memory.js`): Per-`contextId` conversation history (Slack channel/DM ID or CLI hostname). Stored in `data/memory.json`.
- **Fact store** (`src/agent/facts.js`): Long-term facts injected into every prompt. Stored in `data/facts.json`.
- **Thought journal** (`data/thoughts.jsonl`): Append-only log from the `record_thought` tool.

### Multi-Model Routing (`src/agent/router.js`)

Routes between `FAST_MODEL` and `SMART_MODEL` using keyword heuristics, task length, and optionally an AI routing model (scores complexity 1–10; ≥6 → smart model).

### Tool Registry (`src/tools/index.js`)

Each tool is `{ name, description, riskLevel, parameters, execute() }`. Risk levels: `safe`, `moderate`, `dangerous`. The registry transforms tools to Ollama format and loads plugins dynamically from `./plugins/` or `@goose-plugins/*` npm packages.

Built-in tools: `web_search`, `fetch_url`, `read_file`, `write_file`, `list_directory`, `run_command`, `get_datetime`, `get_system_info`, `record_thought`, `remember_fact`, `delegate_task`, `parallel_delegate`.

### Scheduler (`src/scheduler/index.js`)

Cron-based mission executor driven by `data/missions.json`. Run as a separate PM2 process via `src/scheduler-runner.js`. Each mission can override `allowDangerous` independently.

### Plugin System (`src/plugins/index.js`)

Plugins export a `tools` array of tool definitions. Loaded from `./plugins/` local packages or npm packages in the `@goose-plugins/` scope.

## Environment Configuration

Copy `.env.example` to `.env`. Slack tokens are required only for the Slack interface. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Default model |
| `FAST_MODEL` / `SMART_MODEL` | — | Multi-model routing |
| `MAX_TOOL_ITERATIONS` | — | Loop safeguard |
| `REQUIRE_APPROVAL` | — | Force approval for dangerous tools |
| `ALLOWED_PATHS` | — | Sandbox filesystem access |
| `LOG_LEVEL` | `info` | debug/info/warn/error |

Search tools use `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, or `TAVILY_API_KEY` (checked in that order).

## Test Layout

Tests live in `src/__tests__/` mirroring the source structure. The Slack interface and entry point files are excluded from coverage. All tests mock Ollama and external services.
