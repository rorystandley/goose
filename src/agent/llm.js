/**
 * LLM provider abstraction — sits between the agent loop and the inference backend.
 *
 * Supports two backends, selected via config.LLM_BACKEND:
 *   - 'ollama' (default) — uses the `ollama` npm package
 *   - 'vllm'             — uses the `openai` npm package pointed at vllm-mlx's
 *                           OpenAI-compatible endpoint
 *
 * All consumers (loop.js, router.js, status.js) import from this module
 * and never touch the underlying SDK directly.
 */
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('llm');

// ---------------------------------------------------------------------------
// Backend-specific clients — lazy-initialised on first use
// ---------------------------------------------------------------------------

let _ollamaClient = null;
let _openaiClient = null;
let _initialised = false;

/**
 * Lazy-initialise the appropriate LLM client on first use.
 * Uses dynamic imports so the unused SDK is never loaded.
 */
async function ensureClients() {
  if (_initialised) return;

  if (config.LLM_BACKEND !== 'vllm') {
    const { Ollama } = await import('ollama');
    _ollamaClient = new Ollama({ host: config.OLLAMA_HOST });
  }

  if (config.LLM_BACKEND === 'vllm') {
    const { default: OpenAI } = await import('openai');
    _openaiClient = new OpenAI({
      baseURL: `${config.VLLM_HOST}/v1`,
      apiKey: 'not-needed',
    });
  }

  _initialised = true;
  log.info('LLM backend initialised', { backend: config.LLM_BACKEND });
}

// ---------------------------------------------------------------------------
// Normalised chat interface
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request to the configured LLM backend.
 *
 * @param {{ model: string, messages: object[], tools?: object[] }} params
 * @returns {Promise<{
 *   content: string | null,
 *   toolCalls: Array<{ name: string, arguments: object, id: string | null }> | null,
 *   rawAssistantMessage: object
 * }>}
 */
export async function chat({ model, messages, tools }) {
  await ensureClients();

  if (config.LLM_BACKEND === 'vllm') {
    return _chatVllm({ model, messages, tools });
  }
  return _chatOllama({ model, messages, tools });
}

// ---------------------------------------------------------------------------
// Ollama adapter
// ---------------------------------------------------------------------------

async function _chatOllama({ model, messages, tools }) {
  const response = await _ollamaClient.chat({
    model,
    messages,
    tools: tools?.length ? tools : undefined,
    think: false,
  });

  const msg = response.message;
  const toolCalls = msg.tool_calls?.length
    ? msg.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: tc.function.arguments ?? {},
        id: null, // Ollama doesn't use tool call IDs
      }))
    : null;

  return {
    content: msg.content || null,
    toolCalls,
    rawAssistantMessage: msg,
  };
}

// ---------------------------------------------------------------------------
// vllm-mlx adapter (OpenAI-compatible)
// ---------------------------------------------------------------------------

/** Counter for synthetic tool_call IDs when vllm doesn't provide them */
let _callCounter = 0;

async function _chatVllm({ model, messages, tools }) {
  const effectiveModel = model || config.VLLM_MODEL || config.OLLAMA_MODEL;

  const params = {
    model: effectiveModel,
    messages,
    stream: false,
  };

  if (tools?.length) {
    params.tools = tools;
  }

  const response = await _openaiClient.chat.completions.create(params);
  const choice = response.choices[0];
  const msg = choice.message;

  const toolCalls = msg.tool_calls?.length
    ? msg.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: _safeParse(tc.function.arguments),
        id: tc.id || `call_${++_callCounter}`,
      }))
    : null;

  // Build a rawAssistantMessage that includes tool_calls in OpenAI format
  // so it can be pushed directly into the messages context.
  const rawAssistantMessage = { role: 'assistant' };
  if (msg.content) rawAssistantMessage.content = msg.content;
  if (msg.tool_calls?.length) rawAssistantMessage.tool_calls = msg.tool_calls;

  return {
    content: msg.content || null,
    toolCalls,
    rawAssistantMessage,
  };
}

/**
 * Safely parse tool call arguments. OpenAI returns them as a JSON string;
 * some backends may return an object directly.
 */
function _safeParse(args) {
  if (typeof args === 'object' && args !== null) return args;
  try {
    return JSON.parse(args);
  } catch {
    log.warn('Failed to parse tool call arguments', { args });
    return {};
  }
}

// ---------------------------------------------------------------------------
// Tool result message builder
// ---------------------------------------------------------------------------

/**
 * Build a tool result message in the correct format for the active backend.
 *
 * Ollama:  { role: 'tool', content }
 * OpenAI:  { role: 'tool', content, tool_call_id }
 *
 * @param {string | null} toolCallId — the ID from the tool call (null for Ollama)
 * @param {string} content — the tool's output
 * @returns {object}
 */
export function makeToolResultMessage(toolCallId, content) {
  if (config.LLM_BACKEND === 'vllm' && toolCallId) {
    return { role: 'tool', content, tool_call_id: toolCallId };
  }
  return { role: 'tool', content };
}

// ---------------------------------------------------------------------------
// Health check / model listing
// ---------------------------------------------------------------------------

/**
 * List available models on the configured backend.
 * @returns {Promise<{ ok: boolean, models: string[] }>}
 */
export async function listModels() {
  await ensureClients();

  try {
    if (config.LLM_BACKEND === 'vllm') {
      const res = await _openaiClient.models.list();
      const models = [];
      for await (const model of res) {
        models.push(model.id);
      }
      return { ok: true, models };
    }

    // Ollama
    const res = await _ollamaClient.list();
    const models = (res.models ?? []).map(m => m.name);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

/**
 * Human-readable name for the active backend.
 */
export function getBackendName() {
  return config.LLM_BACKEND === 'vllm' ? 'vllm-mlx' : 'Ollama';
}
