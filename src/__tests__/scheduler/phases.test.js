import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFileSync  = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync     = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
}));

const mockSchedule  = vi.hoisted(() => vi.fn());
const mockValidate  = vi.hoisted(() => vi.fn());

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}));

const mockRunAgent = vi.hoisted(() => vi.fn());
vi.mock('../../agent/loop.js', () => ({
  runAgent: async (...args) => {
    const value = await mockRunAgent(...args);
    return typeof value === 'string' ? { status: 'completed', result: value, verified: false } : value;
  },
}));
const runStore = vi.hoisted(() => new Map());
vi.mock('../../execution/store.js', () => ({
  fingerprint: value => JSON.stringify(value),
  readRun: id => runStore.get(id) ?? null,
  writeRun: (id, state) => runStore.set(id, structuredClone(state)),
  acquireRun: () => () => {},
}));
vi.mock('../../execution/verify.js', () => ({
  validateCriteria: () => {},
  snapshotArtifacts: async () => ({}),
  verifyArtifacts: async () => ({ verified: true, evidence: [] }),
}));

vi.mock('../../tools/index.js', () => ({
  initTools: vi.fn().mockResolvedValue(undefined),
  toolMap: {},
}));

vi.mock('../../config.js', () => ({
  default: {
    MISSIONS_PATH: '/tmp/missions.json',
    SCHEDULER_ALLOW_DANGEROUS: false,
  },
}));

import { startScheduler, makeSchedulerCallbacks } from '../../scheduler/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function missionsJson(missions) {
  return JSON.stringify({ missions });
}

const phasedMission = {
  name: 'twitter-marketing',
  cron: '0 */1 * * *',
  contextId: 'mission-twitter',
  slackChannel: 'C123',
  timezone: 'Europe/London',
  enabled: true,
  phases: [
    {
      name: 'gather',
      task: 'Gather research data.',
      maxIterations: 5,
    },
    {
      name: 'compose',
      task: 'Compose a tweet from gathered data.',
      injectPreviousResult: true,
      noTools: true,
    },
    {
      name: 'post',
      task: 'Post the tweet.',
      injectPreviousResult: true,
      allowDangerous: true,
      maxIterations: 3,
    },
  ],
};

async function runCronCallback(mission, notifyFn = null) {
  mockReadFileSync.mockReturnValue(missionsJson([mission]));
  await startScheduler(notifyFn);
  const cronFn = mockSchedule.mock.calls[0][1];
  await cronFn();
}

beforeEach(() => {
  vi.clearAllMocks();
  runStore.clear();
  mockValidate.mockReturnValue(true);
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockSchedule.mockReturnValue({ stop: vi.fn() });
  mockRunAgent.mockResolvedValue('phase result');
});

// ---------------------------------------------------------------------------
// Phase-based mission execution
// ---------------------------------------------------------------------------
describe('startScheduler — phase-based missions', () => {
  it('calls runAgent once per phase in sequential order', async () => {
    mockRunAgent
      .mockResolvedValueOnce('gathered data')
      .mockResolvedValueOnce('composed tweet')
      .mockResolvedValueOnce('posted successfully');

    await runCronCallback(phasedMission);

    expect(mockRunAgent).toHaveBeenCalledTimes(3);

    // Phase 1: gather
    expect(mockRunAgent.mock.calls[0][0]).toBe('Gather research data.');
    // Phase 2: compose
    expect(mockRunAgent.mock.calls[1][0]).toContain('Compose a tweet from gathered data.');
    // Phase 3: post
    expect(mockRunAgent.mock.calls[2][0]).toContain('Post the tweet.');
  });

  it('injects previous phase result when injectPreviousResult is true', async () => {
    mockRunAgent
      .mockResolvedValueOnce('gathered data here')
      .mockResolvedValueOnce('composed tweet text')
      .mockResolvedValueOnce('posted');

    await runCronCallback(phasedMission);

    // Phase 2 should include phase 1's output
    const phase2Task = mockRunAgent.mock.calls[1][0];
    expect(phase2Task).toContain('Context from previous phase:');
    expect(phase2Task).toContain('gathered data here');

    // Phase 3 should include phase 2's output
    const phase3Task = mockRunAgent.mock.calls[2][0];
    expect(phase3Task).toContain('Context from previous phase:');
    expect(phase3Task).toContain('composed tweet text');
  });

  it('does NOT inject previous result when injectPreviousResult is not set', async () => {
    mockRunAgent.mockResolvedValue('some result');
    await runCronCallback(phasedMission);

    // Phase 1 (gather) has no injectPreviousResult
    const phase1Task = mockRunAgent.mock.calls[0][0];
    expect(phase1Task).toBe('Gather research data.');
    expect(phase1Task).not.toContain('Context from previous phase:');
  });

  it('passes noTools as empty subAgentTools', async () => {
    mockRunAgent.mockResolvedValue('result');
    await runCronCallback(phasedMission);

    // Phase 2 (compose) has noTools: true
    const phase2Options = mockRunAgent.mock.calls[1][2];
    expect(phase2Options.subAgentTools).toEqual({
      toolMap: {},
      toolDefinitions: [],
    });

    // Phase 1 should NOT have subAgentTools
    const phase1Options = mockRunAgent.mock.calls[0][2];
    expect(phase1Options.subAgentTools).toBeUndefined();
  });

  it('scopes allowDangerous per-phase via makeSchedulerCallbacks', async () => {
    mockRunAgent.mockResolvedValue('result');
    await runCronCallback(phasedMission);

    // Phase 1 (gather): allowDangerous not set → false
    const phase1Cb = mockRunAgent.mock.calls[0][2];
    const phase1Approved = await phase1Cb.onToolCall({ toolName: 'run_command', requiresApproval: true });
    expect(phase1Approved).toBe(false);

    // Phase 3 (post): allowDangerous: true
    const phase3Cb = mockRunAgent.mock.calls[2][2];
    const phase3Approved = await phase3Cb.onToolCall({ toolName: 'run_command', requiresApproval: true });
    expect(phase3Approved).toBe(true);
  });

  it('passes maxIterations per-phase when set', async () => {
    mockRunAgent.mockResolvedValue('result');
    await runCronCallback(phasedMission);

    // Phase 1: maxIterations: 5
    expect(mockRunAgent.mock.calls[0][2].maxIterations).toBe(5);
    // Phase 2: no maxIterations
    expect(mockRunAgent.mock.calls[1][2].maxIterations).toBeUndefined();
    // Phase 3: maxIterations: 3
    expect(mockRunAgent.mock.calls[2][2].maxIterations).toBe(3);
  });

  it('uses the final phase result for saveResponseTo', async () => {
    mockRunAgent
      .mockResolvedValueOnce('gathered')
      .mockResolvedValueOnce('composed')
      .mockResolvedValueOnce('final posted result');

    const mission = { ...phasedMission, saveResponseTo: 'data/output.txt' };
    await runCronCallback(mission);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('data/output.txt'),
      'final posted result',
      'utf8',
    );
  });

  it('uses the final phase result for notification', async () => {
    mockRunAgent
      .mockResolvedValueOnce('gathered')
      .mockResolvedValueOnce('composed')
      .mockResolvedValueOnce('final notification text');

    const notify = vi.fn().mockResolvedValue(undefined);
    await runCronCallback(phasedMission, notify);

    expect(notify).toHaveBeenCalledWith('C123', 'twitter-marketing', 'final notification text');
  });

  it('uses the same contextId for all phases', async () => {
    mockRunAgent.mockResolvedValue('result');
    await runCronCallback(phasedMission);

    const contextIds = mockRunAgent.mock.calls.map(call => call[1]);
    expect(contextIds).toEqual([
      'mission-twitter',
      'mission-twitter',
      'mission-twitter',
    ]);
  });

  it('catches errors in phase execution without propagating', async () => {
    mockRunAgent.mockRejectedValueOnce(new Error('Ollama offline'));
    await expect(runCronCallback(phasedMission)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Non-phase missions still work (regression guard)
// ---------------------------------------------------------------------------
describe('startScheduler — non-phase missions still work', () => {
  const simpleMission = {
    name: 'morning-briefing',
    cron: '0 8 * * MON-FRI',
    task: 'Check the weather',
    contextId: 'mission-morning-briefing',
    slackChannel: 'C123',
    timezone: 'Europe/London',
    enabled: true,
  };

  it('calls runAgent once with the mission task for non-phase missions', async () => {
    await runCronCallback(simpleMission);
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(mockRunAgent).toHaveBeenCalledWith(
      'Check the weather',
      'mission-morning-briefing',
      expect.any(Object),
    );
  });
});
