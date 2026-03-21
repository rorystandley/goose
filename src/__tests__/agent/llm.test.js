import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must exist before vi.mock() factory functions run
// ---------------------------------------------------------------------------
const mockOllamaChat = vi.hoisted(() => vi.fn());
const mockOllamaList = vi.hoisted(() => vi.fn());
const mockOpenAICreate = vi.hoisted(() => vi.fn());
const mockOpenAIModelsList = vi.hoisted(() => vi.fn());

let mockConfig = vi.hoisted(() => ({
  LLM_BACKEND: 'ollama',
  OLLAMA_HOST: 'http://localhost:11434',
  OLLAMA_MODEL: 'qwen3:14b',
  VLLM_HOST: 'http://localhost:8000',
  VLLM_MODEL: 'mlx-community/Qwen3.5-35B-A3B-4bit',
}));

vi.mock('../../config.js', () => ({ default: mockConfig }));

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(function () {
    return { chat: mockOllamaChat, list: mockOllamaList };
  }),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      chat: { completions: { create: mockOpenAICreate } },
      models: { list: mockOpenAIModelsList },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ollama backend', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockConfig.LLM_BACKEND = 'ollama';
  });

  it('chat() normalises a text response', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOllamaChat.mockResolvedValue({
      message: { content: 'Hello world', tool_calls: undefined },
    });

    const result = await chat({ model: 'qwen3:14b', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toBeNull();
    expect(result.rawAssistantMessage).toEqual({ content: 'Hello world', tool_calls: undefined });
  });

  it('chat() normalises tool calls with null IDs', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOllamaChat.mockResolvedValue({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'web_search', arguments: { query: 'test' } } }],
      },
    });

    const result = await chat({ model: 'qwen3:14b', messages: [], tools: [] });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ name: 'web_search', arguments: { query: 'test' }, id: null });
  });

  it('chat() passes think: false to Ollama', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOllamaChat.mockResolvedValue({ message: { content: 'ok' } });

    await chat({ model: 'qwen3:14b', messages: [] });

    expect(mockOllamaChat).toHaveBeenCalledWith(expect.objectContaining({ think: false }));
  });

  it('makeToolResultMessage() returns simple format without tool_call_id', async () => {
    const { makeToolResultMessage } = await import('../../agent/llm.js');

    const msg = makeToolResultMessage(null, 'result text');
    expect(msg).toEqual({ role: 'tool', content: 'result text' });
    expect(msg).not.toHaveProperty('tool_call_id');
  });

  it('listModels() returns models from Ollama', async () => {
    const { listModels } = await import('../../agent/llm.js');
    mockOllamaList.mockResolvedValue({ models: [{ name: 'qwen3:14b' }, { name: 'llama3:8b' }] });

    const result = await listModels();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['qwen3:14b', 'llama3:8b']);
  });

  it('listModels() returns ok: false when Ollama is unreachable', async () => {
    const { listModels } = await import('../../agent/llm.js');
    mockOllamaList.mockRejectedValue(new Error('Connection refused'));

    const result = await listModels();
    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
  });
});

describe('vllm backend', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockConfig.LLM_BACKEND = 'vllm';
  });

  it('chat() normalises a text response', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello from vllm', tool_calls: undefined } }],
    });

    const result = await chat({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toBe('Hello from vllm');
    expect(result.toolCalls).toBeNull();
  });

  it('chat() parses JSON string arguments from tool calls', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOpenAICreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_abc123',
            function: { name: 'web_search', arguments: '{"query":"test"}' },
          }],
        },
      }],
    });

    const result = await chat({ model: 'test-model', messages: [], tools: [] });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
    expect(result.toolCalls[0].arguments).toEqual({ query: 'test' });
    expect(result.toolCalls[0].id).toBe('call_abc123');
  });

  it('chat() generates synthetic IDs when tool call has no ID', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOpenAICreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: '',
            function: { name: 'get_datetime', arguments: '{}' },
          }],
        },
      }],
    });

    const result = await chat({ model: 'test-model', messages: [], tools: [] });

    expect(result.toolCalls[0].id).toMatch(/^call_\d+$/);
  });

  it('chat() handles malformed JSON arguments gracefully', async () => {
    const { chat } = await import('../../agent/llm.js');
    mockOpenAICreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_bad',
            function: { name: 'broken', arguments: 'not-json' },
          }],
        },
      }],
    });

    const result = await chat({ model: 'test-model', messages: [], tools: [] });

    expect(result.toolCalls[0].arguments).toEqual({});
  });

  it('makeToolResultMessage() includes tool_call_id for vllm', async () => {
    const { makeToolResultMessage } = await import('../../agent/llm.js');

    const msg = makeToolResultMessage('call_abc', 'result text');
    expect(msg).toEqual({ role: 'tool', content: 'result text', tool_call_id: 'call_abc' });
  });
});

describe('getBackendName', () => {
  it('returns "Ollama" for ollama backend', async () => {
    vi.resetModules();
    mockConfig.LLM_BACKEND = 'ollama';
    const { getBackendName } = await import('../../agent/llm.js');
    expect(getBackendName()).toBe('Ollama');
  });

  it('returns "vllm-mlx" for vllm backend', async () => {
    vi.resetModules();
    mockConfig.LLM_BACKEND = 'vllm';
    const { getBackendName } = await import('../../agent/llm.js');
    expect(getBackendName()).toBe('vllm-mlx');
  });
});
