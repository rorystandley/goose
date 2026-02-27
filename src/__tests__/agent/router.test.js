import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockOllamaChat = vi.hoisted(() => vi.fn());

vi.mock('ollama', () => ({
  default: { chat: mockOllamaChat },
}));

// Config is mocked per test group — re-imported after mock is set
let mockConfig = vi.hoisted(() => ({
  OLLAMA_MODEL:  'default-model',
  FAST_MODEL:    'fast-model',
  SMART_MODEL:   'smart-model',
  ROUTING_MODEL: '',
  OLLAMA_HOST:   'http://localhost:11434',
}));

vi.mock('../../config.js', () => ({ default: mockConfig }));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { selectModel } from '../../agent/router.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Reset config to default routing-enabled state (both models set, no routing model)
  mockConfig.OLLAMA_MODEL  = 'default-model';
  mockConfig.FAST_MODEL    = 'fast-model';
  mockConfig.SMART_MODEL   = 'smart-model';
  mockConfig.ROUTING_MODEL = '';

  // Default routing model response
  mockOllamaChat.mockResolvedValue({ message: { content: '5' } });
});

// ---------------------------------------------------------------------------
// Routing disabled
// ---------------------------------------------------------------------------

describe('routing disabled', () => {
  it('returns OLLAMA_MODEL when both FAST_MODEL and SMART_MODEL are empty', async () => {
    mockConfig.FAST_MODEL  = '';
    mockConfig.SMART_MODEL = '';
    const result = await selectModel('What time is it?');
    expect(result).toBe('default-model');
    expect(mockOllamaChat).not.toHaveBeenCalled();
  });

  it('returns OLLAMA_MODEL when only FAST_MODEL is set (partial config)', async () => {
    mockConfig.FAST_MODEL  = 'fast-model';
    mockConfig.SMART_MODEL = '';
    const result = await selectModel('Debug my code');
    expect(result).toBe('default-model');
  });

  it('returns OLLAMA_MODEL when only SMART_MODEL is set (partial config)', async () => {
    mockConfig.FAST_MODEL  = '';
    mockConfig.SMART_MODEL = 'smart-model';
    const result = await selectModel('Debug my code');
    expect(result).toBe('default-model');
  });

  it('does not call the routing model when routing is disabled', async () => {
    mockConfig.FAST_MODEL    = '';
    mockConfig.SMART_MODEL   = '';
    mockConfig.ROUTING_MODEL = 'routing-model';
    await selectModel('anything');
    expect(mockOllamaChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Heuristic routing (ROUTING_MODEL not set)
// ---------------------------------------------------------------------------

describe('heuristic routing — SMART keywords', () => {
  it('"debug" → smart model', async () => {
    expect(await selectModel('debug this function')).toBe('smart-model');
  });

  it('"refactor" → smart model', async () => {
    expect(await selectModel('refactor the auth module')).toBe('smart-model');
  });

  it('"analyze" → smart model', async () => {
    expect(await selectModel('analyze the performance of this code')).toBe('smart-model');
  });

  it('"implement" → smart model', async () => {
    expect(await selectModel('implement a new feature')).toBe('smart-model');
  });

  it('"write" → smart model', async () => {
    expect(await selectModel('write a unit test for this module')).toBe('smart-model');
  });

  it('"review" → smart model', async () => {
    expect(await selectModel('review my pull request')).toBe('smart-model');
  });

  it('"explain why" → smart model', async () => {
    expect(await selectModel('explain why this is failing')).toBe('smart-model');
  });
});

describe('heuristic routing — FAST keywords', () => {
  it('"what is" → fast model', async () => {
    expect(await selectModel('what is the capital of France?')).toBe('fast-model');
  });

  it('"who is" → fast model', async () => {
    expect(await selectModel('who is the current president?')).toBe('fast-model');
  });

  it('"tell me" → fast model', async () => {
    expect(await selectModel('tell me the time')).toBe('fast-model');
  });

  it('"list " → fast model', async () => {
    expect(await selectModel('list the files in my home directory')).toBe('fast-model');
  });

  it('"what time" → fast model', async () => {
    expect(await selectModel('what time is it?')).toBe('fast-model');
  });
});

describe('heuristic routing — length signals', () => {
  it('task shorter than 50 chars with no keywords → fast model', async () => {
    expect(await selectModel('Hello there')).toBe('fast-model');
  });

  it('task longer than 150 chars → smart model', async () => {
    const longTask = 'Please help me understand the entire architecture of this system and all the components involved in handling a web request from start to finish, including middleware, routing, and database layers.';
    expect(longTask.length).toBeGreaterThan(150);
    expect(await selectModel(longTask)).toBe('smart-model');
  });
});

describe('heuristic routing — multi-step phrases', () => {
  it('"then" triggers smart model', async () => {
    expect(await selectModel('Read the file then write a summary')).toBe('smart-model');
  });

  it('"after that" triggers smart model', async () => {
    expect(await selectModel('Fetch the data, after that process it')).toBe('smart-model');
  });
});

describe('heuristic routing — default fallback', () => {
  it('medium-length task with no clear keywords → smart model (safe default)', async () => {
    // ~80 chars, no FAST or SMART keywords — should hit the default SMART fallback
    const task = 'Please examine the current state of the deployment and give me a brief overview.';
    expect(task.length).toBeGreaterThan(50);
    expect(task.length).toBeLessThan(150);
    expect(await selectModel(task)).toBe('smart-model');
  });
});

// ---------------------------------------------------------------------------
// AI routing (ROUTING_MODEL set)
// ---------------------------------------------------------------------------

describe('AI routing', () => {
  beforeEach(() => {
    mockConfig.ROUTING_MODEL = 'routing-model';
  });

  // All tasks used in this describe block must be 50–150 chars with no SMART or FAST keywords
  // so they pass both pre-filters and actually reach the AI router.
  const AMBIGUOUS = 'Please examine the current state of the deployment and give me a brief overview';

  it('calls the routing model for ambiguous tasks with no strong smart signal', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '7' } });
    await selectModel(AMBIGUOUS);
    expect(mockOllamaChat).toHaveBeenCalledWith(expect.objectContaining({
      model: 'routing-model',
    }));
  });

  it('score ≥ 6 → smart model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '8' } });
    expect(await selectModel(AMBIGUOUS)).toBe('smart-model');
  });

  it('score < 6 → fast model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '3' } });
    expect(await selectModel(AMBIGUOUS)).toBe('fast-model');
  });

  it('score exactly 6 → smart model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '6' } });
    expect(await selectModel(AMBIGUOUS)).toBe('smart-model');
  });

  it('score exactly 5 → fast model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '5' } });
    expect(await selectModel(AMBIGUOUS)).toBe('fast-model');
  });

  it('non-numeric response → falls back to smart model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: 'seven' } });
    expect(await selectModel(AMBIGUOUS)).toBe('smart-model');
  });

  it('routing model call throws → falls back to smart model', async () => {
    mockOllamaChat.mockRejectedValue(new Error('Ollama offline'));
    expect(await selectModel(AMBIGUOUS)).toBe('smart-model');
  });

  it('decimal score (e.g. "7.5") is handled correctly → smart model', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '7.5' } });
    expect(await selectModel(AMBIGUOUS)).toBe('smart-model');
  });

  it('includes the task in the routing prompt', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '4' } });
    await selectModel(AMBIGUOUS);
    const callArgs = mockOllamaChat.mock.calls[0][0];
    const userMessage = callArgs.messages.find(m => m.role === 'user');
    expect(userMessage.content).toContain(AMBIGUOUS);
  });

  it('passes think: false to the routing model call', async () => {
    mockOllamaChat.mockResolvedValue({ message: { content: '5' } });
    await selectModel(AMBIGUOUS);
    expect(mockOllamaChat).toHaveBeenCalledWith(expect.objectContaining({
      think: false,
    }));
  });

  it('smart keyword task bypasses AI routing and returns smart model directly', async () => {
    await selectModel('summarise the deployment logs from last night');
    // hasSmartSignal() matches "summarise" → AI router never called
    expect(mockOllamaChat).not.toHaveBeenCalled();
  });

  it('long task (>150 chars) bypasses AI routing and returns smart model directly', async () => {
    const longTask = 'Please look at the current state of all our microservices and give me a comprehensive overview of each one including their health status and any recent errors that have been logged.';
    await selectModel(longTask);
    expect(mockOllamaChat).not.toHaveBeenCalled();
  });

  it('fast keyword task bypasses AI routing and returns fast model directly', async () => {
    const result = await selectModel('What is 1 + 1');
    // hasFastSignal() matches "what is" → AI router never called
    expect(mockOllamaChat).not.toHaveBeenCalled();
    expect(result).toBe('fast-model');
  });

  it('short task (<50 chars) bypasses AI routing and returns fast model directly', async () => {
    const result = await selectModel('ping the server');
    expect(mockOllamaChat).not.toHaveBeenCalled();
    expect(result).toBe('fast-model');
  });
});
