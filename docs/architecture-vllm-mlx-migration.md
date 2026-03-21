# Architecture: vllm-mlx Migration

**Status:** Planned
**Date:** 2026-03-21
**Trigger:** Phase-based missions work mechanically (v1.2.0) but the 14B model hallucinates code details, calls `hello_world` as a crutch, and produces generic reflections. A better model is needed — and vllm-mlx enables running models Ollama can't.

---

## Why vllm-mlx

| | Ollama | vllm-mlx |
|---|---|---|
| **Backend** | llama.cpp | MLX (Apple-native) |
| **Apple Silicon** | Good | Purpose-built |
| **Inference speed** | Baseline | 20-50% faster |
| **MoE support** | Limited (can't run Qwen3.5-35B-A3B) | Full support |
| **Tool calling** | Native | OpenAI-compatible (`--enable-auto-tool-choice`) |
| **API format** | Ollama REST | OpenAI-compatible REST |

### Target model

**Qwen3.5-35B-A3B** — Mixture-of-Experts with only 3B active parameters per forward pass. 4-bit quantized fits in ~9GB VRAM on the Mac mini M4 24GB, leaving headroom for context. Significantly better reasoning than Qwen3:14b while being comparable speed due to MoE architecture.

---

## Architecture: Provider Abstraction

Rather than replacing Ollama everywhere, create a **provider abstraction layer** (`src/agent/llm.js`) that sits between the agent and whichever backend is configured. Switch via `LLM_BACKEND` env var. Ollama remains the default.

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│  loop.js     │────▶│  llm.js      │────▶│  Ollama         │
│  router.js   │     │  (provider)  │     │  (default)      │
│  status.js   │     │              │────▶│  vllm-mlx       │
└──────────────┘     └──────────────┘     │  (LLM_BACKEND=  │
                                          │   vllm)          │
                                          └─────────────────┘
```

### `llm.js` exports

```javascript
// Normalized chat response
chat({ model, messages, tools }) → {
  content: string | null,
  toolCalls: [{ name, arguments, id }] | null,
  rawAssistantMessage: object  // push directly into context
}

// Build correct tool result message per backend
makeToolResultMessage(toolCallId, content) → { role: 'tool', ... }

// Health check
listModels() → string[]
```

---

## API Differences

The tool definition format (`{ type: 'function', function: { name, description, parameters } }`) is **identical** between Ollama and OpenAI. The differences are in the response shape and tool result threading:

| Aspect | Ollama (`ollama.chat()`) | OpenAI (`openai.chat.completions.create()`) |
|--------|--------------------------|---------------------------------------------|
| Response path | `response.message` | `response.choices[0].message` |
| Tool call arguments | Parsed **object** | JSON **string** → needs `JSON.parse()` |
| Tool call IDs | Not used | **Required** — must thread back in results |
| Tool result format | `{ role: 'tool', content }` | `{ role: 'tool', content, tool_call_id }` |
| Thinking suppression | `think: false` | System prompt instruction or `--chat-template` |
| Streaming default | Non-streaming | Non-streaming (`stream: false`) |

### Critical: tool_call_id threading

OpenAI requires every tool result message to reference the `tool_call_id` from the assistant's tool call. The flow:

```
Assistant → { tool_calls: [{ id: "call_abc", function: { name: "web_search", arguments: '{"q":"test"}' } }] }
Tool result → { role: "tool", content: "result text", tool_call_id: "call_abc" }
```

Ollama ignores IDs entirely. The `llm.js` adapter normalizes this so `loop.js` doesn't need to know.

---

## Files to Change

| File | Change | Risk |
|------|--------|------|
| `src/agent/llm.js` | **NEW** — provider abstraction | Low — no existing code |
| `src/config.js` | Add `LLM_BACKEND`, `VLLM_HOST`, `VLLM_MODEL` | Low — additive, defaults preserve Ollama |
| `src/agent/loop.js` | `ollama.chat()` → `llm.chat()`, tool result messages via `makeToolResultMessage()` | **High** — core agent loop |
| `src/agent/router.js` | `ollama.chat()` → `llm.chat()` | Medium — single call site |
| `src/interfaces/slack/status.js` | `ollama.list()` → `llm.listModels()` | Low — display only |
| `src/tools/index.js` | Rename `getOllamaToolDefinitions()` → `getToolDefinitions()` | Low — name only, format unchanged |
| `src/tools/agent.js` | Update function reference | Low |
| `ecosystem.config.cjs` | Add vllm-mlx PM2 process | Low |
| `package.json` | Add `openai` dependency | Low |
| `.env.example` | Document new env vars | Low |
| `src/__tests__/agent/llm.test.js` | **NEW** — provider tests | Low |
| `src/__tests__/agent/loop.test.js` | Mock `llm.js` instead of `ollama` | Medium — many mocks |
| `src/__tests__/agent/router.test.js` | Mock `llm.js` instead of `ollama` | Low — few mocks |

---

## Implementation Steps

### Step 1: Install dependency
```bash
npm install openai
```

### Step 2: Config (`src/config.js`)

Add to the frozen config object:
```javascript
LLM_BACKEND: process.env.LLM_BACKEND || 'ollama',        // 'ollama' | 'vllm'
VLLM_HOST:   process.env.VLLM_HOST   || 'http://localhost:8000',
VLLM_MODEL:  process.env.VLLM_MODEL  || '',
```

### Step 3: Provider abstraction (`src/agent/llm.js`)

New file. Creates the appropriate client at module load time based on `config.LLM_BACKEND`.

**Ollama path:**
- `new Ollama({ host: config.OLLAMA_HOST })`
- `ollama.chat({ model, messages, tools, think: false })`
- Normalize: `response.message.content`, map tool_calls to `{ name, arguments (object), id: null }`

**vllm path:**
- `new OpenAI({ baseURL: config.VLLM_HOST + '/v1', apiKey: 'not-needed' })`
- `openai.chat.completions.create({ model, messages, tools })`
- Normalize: `response.choices[0].message.content`, map tool_calls to `{ name, arguments: JSON.parse(...), id: tc.id }`

**Thinking suppression for vllm:**
Qwen3 on vllm-mlx doesn't have `think: false`. Options:
1. Add `/no_think` to system prompt (simplest)
2. Use `--chat-template` flag on vllm server
3. Strip `<think>` tokens (already done in `stripThinking()`)

Recommendation: Use option 1 in the adapter + keep `stripThinking()` as safety net.

### Step 4: Update `src/tools/index.js`

Rename `getOllamaToolDefinitions()` → `getToolDefinitions()`. The function body stays identical — the format is the same for both backends.

### Step 5: Update `src/agent/loop.js`

Key changes to `loop.js`:
```javascript
// Before:
import { Ollama } from 'ollama';
const ollama = new Ollama({ host: config.OLLAMA_HOST });

// After:
import { chat, makeToolResultMessage } from './llm.js';
```

Replace `ollama.chat()` calls:
```javascript
// Before:
response = await ollama.chat({ model, messages, tools: toolDefinitions, think: false });
const assistantMessage = response.message;

// After:
const result = await chat({ model, messages, tools: toolDefinitions });
const assistantMessage = result.rawAssistantMessage;
// content is result.content, toolCalls is result.toolCalls
```

Replace tool result messages:
```javascript
// Before:
messages.push({ role: 'tool', content: String(result) });

// After:
messages.push(makeToolResultMessage(toolCall.id, String(result)));
```

Same for error/denial messages (lines 172, 188).

Denial finalisation call:
```javascript
// Before:
const finalResponse = await ollama.chat({ model, messages, think: false });
const content = stripThinking(finalResponse.message.content || 'Action cancelled.');

// After:
const finalResult = await chat({ model, messages });
const content = stripThinking(finalResult.content || 'Action cancelled.');
```

### Step 6: Update `src/agent/router.js`

```javascript
// Before:
import ollama from 'ollama';
const response = await ollama.chat({ model: config.ROUTING_MODEL, messages, think: false });
const raw = (response.message?.content || '').trim();

// After:
import { chat } from './llm.js';
const result = await chat({ model: config.ROUTING_MODEL, messages: [{ role: 'user', content: prompt }] });
const raw = (result.content || '').trim();
```

### Step 7: Update `src/interfaces/slack/status.js`

```javascript
// Before:
import { Ollama } from 'ollama';
const ollama = new Ollama({ host: config.OLLAMA_HOST });
const res = await ollama.list();

// After:
import { listModels, getBackendName } from '../../agent/llm.js';
const models = await listModels();
// Update display text: "Ollama" → getBackendName() (returns "Ollama" or "vllm-mlx")
```

### Step 8: Update tests

**`src/__tests__/agent/loop.test.js`:**
```javascript
// Before:
vi.mock('ollama', () => ({ Ollama: vi.fn(() => ({ chat: mockChat })) }));

// After:
vi.mock('../../agent/llm.js', () => ({
  chat: mockChat,           // returns { content, toolCalls, rawAssistantMessage }
  makeToolResultMessage: (id, content) => ({ role: 'tool', content }),
}));
```

Mock helpers update:
```javascript
// textReply: { content: 'text', toolCalls: null, rawAssistantMessage: { role: 'assistant', content: 'text' } }
// toolReply: { content: null, toolCalls: [{ name, arguments, id }], rawAssistantMessage: { ... } }
```

**New `src/__tests__/agent/llm.test.js`:**
- Test Ollama adapter: mock `ollama` package, verify normalization
- Test vllm adapter: mock `openai` package, verify `JSON.parse` on arguments, tool_call_id threading
- Test `makeToolResultMessage` for both backends
- Test `listModels` for both backends

### Step 9: PM2 config (`ecosystem.config.cjs`)

```javascript
{
  name: 'vllm',
  script: 'vllm',
  args: 'serve mlx-community/Qwen3.5-35B-A3B-4bit --enable-auto-tool-choice --host 0.0.0.0 --port 8000',
  interpreter: 'none',
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 5,
  watch: false,
}
```

### Step 10: Update `.env.example`

```bash
# LLM Backend — 'ollama' (default) or 'vllm' (vllm-mlx, Apple Silicon optimized)
# LLM_BACKEND=ollama
# VLLM_HOST=http://localhost:8000
# VLLM_MODEL=mlx-community/Qwen3.5-35B-A3B-4bit
```

---

## Multi-Model Routing

vllm-mlx serves **one model per process** (unlike Ollama which swaps). For the Mac mini M4 24GB:

**Recommended:** Single model, routing disabled. Set `VLLM_MODEL` and leave `FAST_MODEL`/`SMART_MODEL` empty. The router already returns `OLLAMA_MODEL` (which maps to `VLLM_MODEL`) when routing is disabled.

**Alternative:** Run two vllm-mlx instances on different ports. Not recommended for 24GB — memory pressure.

**Hybrid:** Use vllm-mlx for main model, keep Ollama for a tiny routing model. Adds complexity, defer to a follow-up.

---

## Verification Plan

1. **`npm test`** — all 438+ tests pass with mocks retargeted to `llm.js`
2. **Ollama backward compat** — `LLM_BACKEND=ollama` (or unset), verify existing behavior is identical
3. **vllm-mlx integration** — `LLM_BACKEND=vllm`, start vllm-mlx server, run:
   - `npm run cli` — interactive test
   - `node trigger-mission.js morning-briefing` — phase-based mission
   - `node trigger-mission.js self-improvement` — multi-phase with tool calls
4. **Health check** — `/goose status` shows correct backend name and model count
5. **PM2** — `pm2 start ecosystem.config.cjs` starts vllm alongside goose

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| vllm-mlx doesn't generate `tool_call_id` | Adapter generates synthetic IDs (`call_${counter}`) |
| Thinking tokens leak without `think: false` | `stripThinking()` already handles this; add `/no_think` to system prompt |
| Tests break due to mock shape change | Change mocks in same commit as `llm.js` integration |
| Memory pressure running both backends | Config-based switching, not runtime — only one backend runs at a time |
| Model name format difference (`qwen3:14b` vs `mlx-community/...`) | Names are just strings passed through config — no code change needed |
