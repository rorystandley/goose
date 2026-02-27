# Goose — Memory System

Goose has persistent, per-context conversation memory. Every message is saved to disk so the agent remembers prior exchanges across restarts, reboots, and deployments.

---

## How it works

### Short-term memory: sliding window

Each conversation is stored as an ordered list of `{ role, content }` messages under a **context ID** (see below). The list is capped at **20 messages** — when a 21st message arrives, the oldest is dropped. This keeps the LLM context window lean: 20 messages is roughly 2–4k tokens, well within `qwen2.5:14b`'s 32k window.

```
[msg 1]  ← oldest — will be dropped when msg 21 arrives
[msg 2]
...
[msg 20] ← most recent
```

On every request, `loop.js` builds the full message array:
```
[system prompt] + [last ≤20 messages] + [new user message]
```
and sends it to Ollama. The LLM sees the complete recent conversation as context.

### Persistent storage: JSON file

Memory is stored in `data/memory.json` — a plain JSON object keyed by context ID:

```json
{
  "U0AFZNMUMRV": [
    { "role": "user",      "content": "It's green" },
    { "role": "assistant", "content": "Got it — your favourite colour is green!" }
  ],
  "cli-mymachine.local": [
    { "role": "user",      "content": "Summarise ~/Downloads" },
    { "role": "assistant", "content": "Found 14 files..." }
  ]
}
```

The file is written **synchronously after every mutation** (`addMessage`, `clearHistory`). On startup, it is read once into memory; all reads during a session are in-process (no disk I/O per message).

---

## Context IDs

Each interface uses a different context ID to scope memory:

| Interface | Context ID | Example |
|---|---|---|
| Slack DM | Slack user ID | `U0AFZNMUMRV` |
| Slack `/goose` command | Slack channel ID | `C07ABCD1234` |
| CLI | `cli-<hostname>` | `cli-mymachine.local` |

> **Note:** Slack DMs and `/goose` channel commands are separate memory buckets. A fact shared in a DM is not visible in a channel slash command and vice versa. This is intentional — channel history should not leak into DMs.

---

## Clearing memory

| Interface | How to clear |
|---|---|
| Slack DM | Send `clear memory` in a DM |
| CLI | Type `clear memory` at the prompt |

Clearing removes the context's entry from `data/memory.json` entirely.

---

## File size and scaling

With the 20-message cap per context, the file stays small regardless of how many conversations have taken place:

| Contexts | Avg messages | Avg message size | Approx file size |
|---|---|---|---|
| 10 users | 20 each | 200 chars | ~40 KB |
| 100 users | 20 each | 200 chars | ~400 KB |
| 1,000 users | 20 each | 200 chars | ~4 MB |
| 10,000 users | 20 each | 200 chars | ~40 MB |

At 40 MB the synchronous full-file-write on every message would start to be noticeable. In practice, for a personal agent running on a single machine, the file will stay under 1 MB indefinitely. If you're running Goose for a larger team, consider moving to a proper database (SQLite is the natural next step — it was used previously but reverted due to native compilation issues).

The JSON file is **not committed to git** — `data/` is in `.gitignore`.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MEMORY_PATH` | `data/memory.json` | Path to the memory file. Absolute or relative to the project root. |

Override in `.env`:
```
MEMORY_PATH=/var/goose/memory.json
```

---

## Long-term memory — fact store

The sliding window forgets. But facts about the user shouldn't. The fact store solves this with a separate, permanent key-value store that never drops entries.

### How it works

When Goose learns something worth keeping — your name, location, preferences, hardware, habits — it calls the `remember_fact` tool:

```
remember_fact(key="name", value="Alice")
remember_fact(key="location", value="New York")
```

Facts are stored in `data/facts.json` as a flat JSON object:

```json
{
  "name": "Alice",
  "location": "New York"
}
```

On every request, all stored facts are injected at the top of the system prompt — before the conversation history:

```
KNOWN FACTS — things you have learned about the user that never expire:
- name: Alice
- location: New York

MEMORY — you have persistent memory of your conversations:
...
```

### What this means in practice

```
┌─────────────────────────────────────┐
│  Short-term: sliding window         │
│  Last 20 messages per context       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Long-term: fact store              │
│  Never expires, cross-context       │
│  Injected into every system prompt  │
└─────────────────────────────────────┘
```

Facts survive memory clears, interface switches, restarts, and the sliding window filling up. `clear memory` only wipes the conversation history — facts are untouched.

### Seeding facts

Tell Goose directly and it will record them:

```bash
npm run cli -- "My name is Alice, I live in New York, and I work in Node.js"
```

Or write `data/facts.json` directly:

```json
{
  "name": "Alice",
  "location": "New York",
  "occupation": "developer"
}
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `FACTS_PATH` | `data/facts.json` | Path to the fact store. |

---

## Implementation reference

| File | Role |
|---|---|
| `src/agent/memory.js` | `getHistory()`, `addMessage()`, `clearHistory()` — sliding window |
| `src/agent/facts.js` | `getFacts()`, `setFact()`, `getFactsAsText()` — fact store |
| `src/tools/facts.js` | `remember_fact` tool — called by the model when it learns something |
| `src/agent/loop.js` | Injects facts + history into every LLM call |
| `src/config.js` | `MEMORY_PATH`, `FACTS_PATH` configuration |
| `data/memory.json` | Sliding window storage (not committed) |
| `data/facts.json` | Permanent fact store (not committed) |
