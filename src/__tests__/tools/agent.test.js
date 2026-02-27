import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const mockRunAgent = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock loop.js so that delegate_task / parallel_delegate don't actually
// spawn real Ollama calls. The dynamic import inside execute() resolves this.
vi.mock('../../agent/loop.js', () => ({
  runAgent: mockRunAgent,
}));

// Mock plugins so index.js initialises cleanly (no filesystem access)
vi.mock('../../plugins/index.js', () => ({
  loadPlugins: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { delegate_task, parallel_delegate, getSubAgentTools } = await import('../../tools/agent.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getSubAgentTools', () => {
  it('excludes delegate_task and parallel_delegate', async () => {
    const { toolMap } = await getSubAgentTools();
    expect(toolMap['delegate_task']).toBeUndefined();
    expect(toolMap['parallel_delegate']).toBeUndefined();
  });

  it('includes core safe tools by default', async () => {
    const { toolMap } = await getSubAgentTools();
    expect(toolMap['web_search']).toBeDefined();
    expect(toolMap['read_file']).toBeDefined();
    expect(toolMap['run_command']).toBeDefined();
  });

  it('returns toolDefinitions in Ollama format', async () => {
    const { toolDefinitions } = await getSubAgentTools();
    expect(Array.isArray(toolDefinitions)).toBe(true);
    for (const def of toolDefinitions) {
      expect(def.type).toBe('function');
      expect(typeof def.function.name).toBe('string');
      expect(typeof def.function.description).toBe('string');
    }
  });

  it('filters to allowlist when allowedToolNames is provided', async () => {
    const { toolMap } = await getSubAgentTools(['web_search', 'read_file']);
    expect(Object.keys(toolMap)).toEqual(expect.arrayContaining(['web_search', 'read_file']));
    expect(Object.keys(toolMap)).not.toContain('run_command');
    expect(Object.keys(toolMap)).not.toContain('write_file');
  });

  it('never includes agent tools even if explicitly in allowlist', async () => {
    const { toolMap } = await getSubAgentTools(['delegate_task', 'parallel_delegate', 'web_search']);
    expect(toolMap['delegate_task']).toBeUndefined();
    expect(toolMap['parallel_delegate']).toBeUndefined();
    expect(toolMap['web_search']).toBeDefined();
  });

  it('toolMap and toolDefinitions have the same length', async () => {
    const { toolMap, toolDefinitions } = await getSubAgentTools();
    expect(toolDefinitions.length).toBe(Object.keys(toolMap).length);
  });
});

// ---------------------------------------------------------------------------

describe('delegate_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgent.mockResolvedValue('sub-agent result');
  });

  it('has correct metadata', () => {
    expect(delegate_task.name).toBe('delegate_task');
    expect(typeof delegate_task.description).toBe('string');
    expect(delegate_task.riskLevel).toBe('moderate');
    expect(delegate_task.parameters.required).toContain('task');
  });

  it('calls runAgent with the provided task', async () => {
    await delegate_task.execute({ task: 'research quantum computing' });
    expect(mockRunAgent).toHaveBeenCalledOnce();
    expect(mockRunAgent.mock.calls[0][0]).toBe('research quantum computing');
  });

  it('returns the runAgent result', async () => {
    mockRunAgent.mockResolvedValue('the answer is 42');
    const result = await delegate_task.execute({ task: 'think of a number' });
    expect(result).toBe('the answer is 42');
  });

  it('uses provided context_id when given', async () => {
    await delegate_task.execute({ task: 'do something', context_id: 'my-context' });
    expect(mockRunAgent.mock.calls[0][1]).toBe('my-context');
  });

  it('generates an ephemeral context_id when none given', async () => {
    await delegate_task.execute({ task: 'do something' });
    const contextId = mockRunAgent.mock.calls[0][1];
    expect(contextId).toMatch(/^sub-agent-\d+$/);
  });

  it('passes subAgentTools option to runAgent', async () => {
    await delegate_task.execute({ task: 'do something' });
    const opts = mockRunAgent.mock.calls[0][2];
    expect(opts.subAgentTools).toBeDefined();
    expect(typeof opts.subAgentTools.toolMap).toBe('object');
    expect(Array.isArray(opts.subAgentTools.toolDefinitions)).toBe(true);
  });

  it('passes maxIterations option to runAgent', async () => {
    await delegate_task.execute({ task: 'do something', max_iterations: 3 });
    const opts = mockRunAgent.mock.calls[0][2];
    expect(opts.maxIterations).toBe(3);
  });

  it('caps max_iterations at 5', async () => {
    await delegate_task.execute({ task: 'do something', max_iterations: 99 });
    const opts = mockRunAgent.mock.calls[0][2];
    expect(opts.maxIterations).toBe(5);
  });

  it('defaults to max_iterations 5 when not provided', async () => {
    await delegate_task.execute({ task: 'do something' });
    const opts = mockRunAgent.mock.calls[0][2];
    expect(opts.maxIterations).toBe(5);
  });

  it('filters tools via allowed_tools', async () => {
    await delegate_task.execute({ task: 'search only', allowed_tools: ['web_search'] });
    const opts = mockRunAgent.mock.calls[0][2];
    expect(opts.subAgentTools.toolMap['web_search']).toBeDefined();
    expect(opts.subAgentTools.toolMap['read_file']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('parallel_delegate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgent.mockResolvedValue('parallel result');
  });

  it('has correct metadata', () => {
    expect(parallel_delegate.name).toBe('parallel_delegate');
    expect(typeof parallel_delegate.description).toBe('string');
    expect(parallel_delegate.riskLevel).toBe('moderate');
    expect(parallel_delegate.parameters.required).toContain('agents');
  });

  it('returns an error string when agents array is empty', async () => {
    const result = await parallel_delegate.execute({ agents: [] });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/error/i);
  });

  it('returns an error string when agents is missing', async () => {
    const result = await parallel_delegate.execute({});
    expect(typeof result).toBe('string');
    expect(result).toMatch(/error/i);
  });

  it('calls runAgent once per agent', async () => {
    await parallel_delegate.execute({
      agents: [
        { task: 'task one' },
        { task: 'task two' },
      ],
    });
    expect(mockRunAgent).toHaveBeenCalledTimes(2);
  });

  it('returns JSON array of {task, result} objects', async () => {
    mockRunAgent
      .mockResolvedValueOnce('result for one')
      .mockResolvedValueOnce('result for two');

    const raw = await parallel_delegate.execute({
      agents: [{ task: 'task one' }, { task: 'task two' }],
    });

    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ task: 'task one', result: 'result for one' });
    expect(parsed[1]).toMatchObject({ task: 'task two', result: 'result for two' });
  });

  it('caps at 4 agents when more are provided', async () => {
    await parallel_delegate.execute({
      agents: [
        { task: 't1' }, { task: 't2' }, { task: 't3' },
        { task: 't4' }, { task: 't5' },
      ],
    });
    expect(mockRunAgent).toHaveBeenCalledTimes(4);
  });

  it('passes subAgentTools to each runAgent call', async () => {
    await parallel_delegate.execute({
      agents: [{ task: 'task one' }, { task: 'task two' }],
    });
    for (const call of mockRunAgent.mock.calls) {
      const opts = call[2];
      expect(opts.subAgentTools).toBeDefined();
    }
  });

  it('uses per-agent allowed_tools', async () => {
    await parallel_delegate.execute({
      agents: [
        { task: 'search', allowed_tools: ['web_search'] },
        { task: 'read',   allowed_tools: ['read_file'] },
      ],
    });
    const [call1, call2] = mockRunAgent.mock.calls;
    expect(call1[2].subAgentTools.toolMap['web_search']).toBeDefined();
    expect(call1[2].subAgentTools.toolMap['read_file']).toBeUndefined();
    expect(call2[2].subAgentTools.toolMap['read_file']).toBeDefined();
    expect(call2[2].subAgentTools.toolMap['web_search']).toBeUndefined();
  });

  it('caps per-agent max_iterations at 5', async () => {
    await parallel_delegate.execute({
      agents: [{ task: 'task', max_iterations: 10 }],
    });
    expect(mockRunAgent.mock.calls[0][2].maxIterations).toBe(5);
  });
});
