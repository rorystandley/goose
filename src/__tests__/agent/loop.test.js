import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock references so they exist before vi.mock() factory functions run
// ---------------------------------------------------------------------------
const mockChat = vi.hoisted(() => vi.fn());

// Mock the ollama package — replaces `new Ollama(...)` in loop.js
vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({ chat: mockChat })),
}));

// Mock memory so we control history without a real Map
vi.mock('../../agent/memory.js', () => ({
  getHistory: vi.fn(() => []),
  addMessage: vi.fn(),
  clearHistory: vi.fn(),
}));

// Mock tools/index.js — two fake tools: one safe, one dangerous
vi.mock('../../tools/index.js', () => ({
  getOllamaToolDefinitions: vi.fn(() => []),
  toolMap: {
    safe_tool: {
      name: 'safe_tool',
      riskLevel: 'safe',
      execute: vi.fn(async () => 'safe result'),
    },
    dangerous_tool: {
      name: 'dangerous_tool',
      riskLevel: 'dangerous',
      execute: vi.fn(async () => 'dangerous result'),
    },
  },
}));

import { runAgent } from '../../agent/loop.js';
import { getHistory, addMessage } from '../../agent/memory.js';
import { toolMap } from '../../tools/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock LLM response with no tool calls (plain text reply). */
function textReply(content) {
  return { message: { content, tool_calls: undefined } };
}

/** Build a mock LLM response requesting one tool call. */
function toolReply(toolName, args = {}) {
  return {
    message: {
      content: '',
      tool_calls: [{ function: { name: toolName, arguments: args } }],
    },
  };
}

/** Default no-op callbacks. */
function makeCallbacks(overrides = {}) {
  return {
    onToolCall: vi.fn(async () => true),
    onToolResult: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getHistory.mockReturnValue([]);
});

describe('runAgent — simple text response', () => {
  it('returns the LLM text reply when no tools are called', async () => {
    mockChat.mockResolvedValueOnce(textReply('Here is the answer.'));

    const result = await runAgent('What is 2+2?', 'ch1', makeCallbacks());

    expect(result).toBe('Here is the answer.');
  });

  it('persists the user message and assistant message to memory', async () => {
    mockChat.mockResolvedValueOnce(textReply('Done.'));

    await runAgent('Do something', 'ch1', makeCallbacks());

    expect(addMessage).toHaveBeenCalledWith('ch1', { role: 'user', content: 'Do something' });
    expect(addMessage).toHaveBeenCalledWith('ch1', { role: 'assistant', content: 'Done.' });
  });

  it('includes conversation history in the messages sent to the LLM', async () => {
    const history = [{ role: 'user', content: 'prev msg' }];
    getHistory.mockReturnValue(history);
    mockChat.mockResolvedValueOnce(textReply('Hi.'));

    await runAgent('new task', 'ch1', makeCallbacks());

    const callMessages = mockChat.mock.calls[0][0].messages;
    // system prompt is first, then history, then user message
    expect(callMessages[0].role).toBe('system');
    expect(callMessages).toContainEqual({ role: 'user', content: 'prev msg' });
  });

  it('falls back to "(No response)" when LLM returns empty content', async () => {
    mockChat.mockResolvedValueOnce(textReply(''));

    const result = await runAgent('task', 'ch1', makeCallbacks());
    expect(result).toBe('(No response)');
  });
});

describe('runAgent — safe tool execution', () => {
  it('executes a safe tool and passes result back to the LLM', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('safe_tool', { input: 'x' }))
      .mockResolvedValueOnce(textReply('Tool said: safe result'));

    const result = await runAgent('use safe tool', 'ch1', makeCallbacks());

    expect(toolMap.safe_tool.execute).toHaveBeenCalledWith({ input: 'x' }, undefined, expect.any(Object));
    expect(result).toBe('Tool said: safe result');
  });

  it('calls onToolCall with requiresApproval: false for safe tools', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('safe_tool'))
      .mockResolvedValueOnce(textReply('done'));

    const callbacks = makeCallbacks();
    await runAgent('use safe tool', 'ch1', callbacks);

    expect(callbacks.onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'safe_tool', requiresApproval: false })
    );
  });

  it('calls onToolResult with the tool name and result', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('safe_tool'))
      .mockResolvedValueOnce(textReply('done'));

    const callbacks = makeCallbacks();
    await runAgent('use safe tool', 'ch1', callbacks);

    expect(callbacks.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'safe_tool', result: 'safe result' })
    );
  });
});

describe('runAgent — dangerous tool approval flow', () => {
  it('executes dangerous tool when approved', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('dangerous_tool'))
      .mockResolvedValueOnce(textReply('dangerous done'));

    const callbacks = makeCallbacks({ onToolCall: vi.fn(async () => true) });
    const result = await runAgent('use dangerous tool', 'ch1', callbacks);

    expect(callbacks.onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'dangerous_tool', requiresApproval: true })
    );
    expect(toolMap.dangerous_tool.execute).toHaveBeenCalled();
    expect(result).toBe('dangerous done');
  });

  it('skips execution when dangerous tool is denied', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('dangerous_tool'))
      .mockResolvedValueOnce(textReply('Action was cancelled.'));

    const callbacks = makeCallbacks({ onToolCall: vi.fn(async () => false) });
    await runAgent('use dangerous tool', 'ch1', callbacks);

    expect(toolMap.dangerous_tool.execute).not.toHaveBeenCalled();
  });
});

describe('runAgent — unknown tool', () => {
  it('returns an error string to the LLM for an unknown tool name', async () => {
    mockChat
      .mockResolvedValueOnce(toolReply('nonexistent_tool'))
      .mockResolvedValueOnce(textReply('I cannot do that.'));

    await runAgent('call missing tool', 'ch1', makeCallbacks());

    // Second LLM call should have received the error in a tool message
    const secondCallMessages = mockChat.mock.calls[1][0].messages;
    const toolMsg = secondCallMessages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('unknown tool');
  });
});

describe('runAgent — LLM error handling', () => {
  it('returns an error string and saves it to memory when LLM throws', async () => {
    mockChat.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await runAgent('do stuff', 'ch1', makeCallbacks());

    expect(result).toContain('LLM error');
    expect(result).toContain('Connection refused');
    expect(addMessage).toHaveBeenCalledWith('ch1', expect.objectContaining({ role: 'assistant' }));
  });
});

describe('runAgent — max iterations', () => {
  it('returns "too complex" message after exceeding MAX_TOOL_ITERATIONS', async () => {
    // Always respond with a tool call — forces the loop to exhaust iterations
    mockChat.mockResolvedValue(toolReply('safe_tool'));
    // Make safe_tool execute cleanly each time
    toolMap.safe_tool.execute.mockResolvedValue('result');

    const result = await runAgent('infinite loop task', 'ch1', makeCallbacks());

    expect(result).toContain('maximum number of steps');
  });
});
