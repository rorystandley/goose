# Goose — Tools Reference

This document describes every tool available to the agent, including parameters, risk level, and behaviour. It also covers how to configure the web search providers.

---

## Discovering Tools at Runtime

You never need to memorise this document. At any time, run:

```
/agent help
```

Goose will post the **live tool list** directly in Slack — automatically including any tools that have been added since this document was last updated. The list is generated directly from the tool registry (`src/tools/index.js`), so it is always accurate.

`/agent tools` and `/agent ?` work identically.

---

## Keeping the Tool List Up to Date

When you add a new tool, **no extra steps are required** for discoverability:

1. Implement the tool in `src/tools/`
2. Register it in `src/tools/index.js`
3. `/agent help` immediately reflects it — no docs update needed

---

## Risk Levels

Every tool has a `riskLevel` that controls whether the agent can run it automatically or must ask for your approval first.

| Level | Behaviour |
|---|---|
| `safe` | Runs automatically with no prompt |
| `moderate` | Runs automatically but logs a warning |
| `dangerous` | Pauses the agent and posts **Approve / Deny** buttons in Slack. Execution only continues after you click Approve. |

Set `REQUIRE_APPROVAL=false` in `.env` to skip approval prompts entirely (not recommended for production use).

---

## Web Tools

Defined in `src/tools/web.js`.

### `web_search`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `query: string` |

Search the web and return the top results (titles, snippets, and URLs). The agent uses this to find current information, news, documentation, or anything it needs to look up online.

The tool automatically selects whichever search provider you have configured. See [Search Providers](#search-providers) below.

**Example agent prompt:**
```
/agent search the web for the latest news on Anthropic
```

---

### `fetch_url`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `url: string` |

Fetches the content of any URL and returns it as plain text. HTML tags (including `<script>` and `<style>` blocks) are stripped before returning. Content is truncated at 3,000 characters.

Useful for reading documentation pages, articles, or any URL the agent finds during a search.

**Example agent prompt:**
```
/agent fetch the content at https://nodejs.org/en/blog and summarise the latest posts
```

---

## Filesystem Tools

Defined in `src/tools/filesystem.js`.

Path access for `write_file` is restricted to the directories listed in `ALLOWED_PATHS` (default: `/Users`). `read_file` and `list_directory` have no path restrictions.

### `read_file`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `path: string` |

Reads a file and returns its contents as text. Truncates at 10,000 characters with a notice if the file is larger.

**Example agent prompt:**
```
/agent read the file /Users/me/notes.txt and summarise it
```

---

### `write_file`

| Property | Value |
|---|---|
| Risk level | `dangerous` ⚠️ |
| Parameters | `path: string`, `content: string` |

Writes content to a file. Creates the file if it does not exist; overwrites it if it does. The path must be within one of the directories configured in `ALLOWED_PATHS`, otherwise the tool returns an access-denied error without writing anything.

Because this is `dangerous`, you will be shown an Approve / Deny prompt in Slack before anything is written.

**Example agent prompt:**
```
/agent write a haiku about the ocean to /Users/me/haiku.txt
```

---

### `list_directory`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `path: string` |

Lists the contents of a directory, showing each entry's name, type (`file` or `dir`), and size in bytes.

**Example agent prompt:**
```
/agent list the files in /Users/me/Downloads
```

---

## Shell Tool

Defined in `src/tools/shell.js`.

### `run_command`

| Property | Value |
|---|---|
| Risk level | `dangerous` ⚠️ |
| Parameters | `command: string` |

Executes a shell command on the local machine using `execSync` and returns the combined stdout and stderr output. Times out after 30 seconds. On failure, returns a structured error message rather than crashing the agent.

Because this is `dangerous`, you will be shown an Approve / Deny prompt in Slack before the command runs.

**Example agent prompt:**
```
/agent run the command: df -h
```

---

## Agent Tools

Internal tools the agent calls on itself — for journalling thoughts and storing persistent facts about the user. These tools are always `safe` and never surface an Approve/Deny prompt.

### `record_thought`

Defined in `src/tools/reflect.js`.

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `thought: string` (required), `context: string` (optional) |

Appends an entry to the thought journal (`data/thoughts.jsonl`) — an append-only JSONL file, one entry per line. Each entry records a timestamp, the thought, and an optional context label.

The agent calls this when something strikes it during a task — a pattern noticed, a question without an obvious answer, an idea worth keeping. It never blocks the task; if the write fails, the failure is swallowed silently.

Scheduled missions with `"postLastThought": true` read this file after the run and post the last entry to Slack instead of the model's response text.

Configure the path with `THOUGHTS_PATH` in `.env` (default: `data/thoughts.jsonl`).

**Example `thoughts.jsonl` entry:**
```json
{"timestamp":"2026-02-24T08:15:33.000Z","thought":"The fetch_url tool strips all HTML but keeps URLs in plain text — which means I could chain web_search → fetch_url → extract_links without any extra parsing.","context":"daily-reflection"}
```

---

### `remember_fact`

Defined in `src/tools/facts.js`.

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | `key: string` (required), `value: string` (required) |

Writes a persistent key-value fact to the fact store (`data/facts.json`). Facts never expire and are not affected by `clear memory`. On every request, all stored facts are injected at the top of the system prompt under a **KNOWN FACTS** section.

The agent calls this when it learns something worth keeping long-term — your name, location, hardware, preferences, or anything you've told it that shouldn't be forgotten when the conversation window slides.

Configure the path with `FACTS_PATH` in `.env` (default: `data/facts.json`).

**Example facts.json:**
```json
{
  "name": "Alice",
  "location": "New York",
  "occupation": "developer"
}
```

See [docs/memory.md](memory.md#long-term-memory--fact-store) for the full write-up.

---

## System Tools

Defined in `src/tools/system.js`.

### `get_datetime`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | *(none)* |

Returns the current date and time on the local machine as a human-readable string, including timezone.

**Example agent prompt:**
```
/agent what time is it?
```

---

### `get_system_info`

| Property | Value |
|---|---|
| Risk level | `safe` |
| Parameters | *(none)* |

Returns basic system information:
- OS platform and architecture
- Total and free memory (in MB)
- Node.js version
- Hostname

**Example agent prompt:**
```
/agent what machine are you running on?
```

---

## Search Providers

`web_search` supports three search providers. You only need **one** — add the API key for whichever provider you choose to your `.env` file. If you configure multiple keys, the tool uses the first one it finds in this priority order:

1. **Brave Search** (`BRAVE_SEARCH_API_KEY`)
2. **Serper** (`SERPER_API_KEY`)
3. **Tavily** (`TAVILY_API_KEY`)

If no key is configured, `web_search` returns an error message explaining how to set one up.

---

### Brave Search

| | |
|---|---|
| Variable | `BRAVE_SEARCH_API_KEY` |
| Pricing | Paid (no free tier) |
| Sign up | https://api.search.brave.com/app/dashboard |
| Docs | https://api.search.brave.com/app/documentation/web-search |

Independent search index — not Google. Good result quality, privacy-focused.

```env
BRAVE_SEARCH_API_KEY=BSA...
```

---

### Serper

| | |
|---|---|
| Variable | `SERPER_API_KEY` |
| Pricing | 2,500 free Google Search results, then paid |
| Sign up | https://serper.dev |
| Docs | https://serper.dev/docs |

Proxies Google Search results via a clean JSON API. The free tier is generous enough for personal use.

```env
SERPER_API_KEY=...
```

---

### Tavily

| | |
|---|---|
| Variable | `TAVILY_API_KEY` |
| Pricing | 1,000 free requests/month, then paid |
| Sign up | https://tavily.com |
| Docs | https://docs.tavily.com |

Search API built specifically for AI agents — returns clean, factual snippets optimised for LLM consumption.

```env
TAVILY_API_KEY=tvly-...
```

---

## All Tools at a Glance

| Tool | File | Risk | Parameters |
|---|---|---|---|
| `web_search` | `tools/web.js` | safe | `query` |
| `fetch_url` | `tools/web.js` | safe | `url` |
| `read_file` | `tools/filesystem.js` | safe | `path` |
| `write_file` | `tools/filesystem.js` | **dangerous** | `path`, `content` |
| `list_directory` | `tools/filesystem.js` | safe | `path` |
| `run_command` | `tools/shell.js` | **dangerous** | `command` |
| `get_datetime` | `tools/system.js` | safe | *(none)* |
| `get_system_info` | `tools/system.js` | safe | *(none)* |
| `record_thought` | `tools/reflect.js` | safe | `thought`, `context` (optional) |
| `remember_fact` | `tools/facts.js` | safe | `key`, `value` |

---

## Adding a New Tool

See the **Adding a New Tool** section in the [README](../README.md) for the tool interface and registration steps.
