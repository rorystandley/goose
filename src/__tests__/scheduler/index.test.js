import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
}));

// node-cron: capture schedule(expr, fn, opts) calls
const mockSchedule  = vi.hoisted(() => vi.fn());
const mockValidate  = vi.hoisted(() => vi.fn());

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}));

const mockRunAgent = vi.hoisted(() => vi.fn());
vi.mock('../../agent/loop.js', () => ({ runAgent: mockRunAgent }));

vi.mock('../../config.js', () => ({
  default: {
    MISSIONS_PATH: '/tmp/missions.json',
    SCHEDULER_ALLOW_DANGEROUS: false,
  },
}));

// Import after mocks
import { loadMissions, makeSchedulerCallbacks, startScheduler } from '../../scheduler/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleMission = {
  name: 'morning-briefing',
  cron: '0 8 * * MON-FRI',
  task: 'Check the weather',
  contextId: 'mission-morning-briefing',
  slackChannel: 'C123',
  timezone: 'Europe/London',
  enabled: true,
};

function missionsJson(missions) {
  return JSON.stringify({ missions });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: valid cron, no existing file
  mockValidate.mockReturnValue(true);
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockSchedule.mockReturnValue({ stop: vi.fn() });
  mockRunAgent.mockResolvedValue('Mission result text');
});

// ---------------------------------------------------------------------------
// loadMissions
// ---------------------------------------------------------------------------
describe('loadMissions', () => {
  it('returns empty array when file does not exist', () => {
    expect(loadMissions()).toEqual([]);
  });

  it('returns empty array when JSON is invalid', () => {
    mockReadFileSync.mockReturnValue('not valid json {{');
    expect(loadMissions()).toEqual([]);
  });

  it('returns empty array when missions property is missing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ something: 'else' }));
    expect(loadMissions()).toEqual([]);
  });

  it('returns missions array from a valid file', () => {
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    expect(loadMissions()).toHaveLength(1);
    expect(loadMissions()[0].name).toBe('morning-briefing');
  });
});

// ---------------------------------------------------------------------------
// startScheduler — mission registration
// ---------------------------------------------------------------------------
describe('startScheduler — registration', () => {
  it('returns empty array and logs when no missions are loaded', () => {
    const tasks = startScheduler();
    expect(tasks).toEqual([]);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('skips disabled missions', () => {
    mockReadFileSync.mockReturnValue(missionsJson([{ ...sampleMission, enabled: false }]));
    const tasks = startScheduler();
    expect(tasks).toEqual([]);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('skips missions with an invalid cron expression', () => {
    mockValidate.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    const tasks = startScheduler();
    expect(tasks).toEqual([]);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('registers one cron job for a valid enabled mission', () => {
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    const tasks = startScheduler();
    expect(tasks).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledOnce();
  });

  it('passes the correct cron expression and timezone to node-cron', () => {
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    startScheduler();
    expect(mockSchedule).toHaveBeenCalledWith(
      '0 8 * * MON-FRI',
      expect.any(Function),
      { timezone: 'Europe/London' },
    );
  });

  it('uses mission.contextId when provided', async () => {
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    startScheduler();
    // Invoke the registered cron callback
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    expect(mockRunAgent).toHaveBeenCalledWith(
      'Check the weather',
      'mission-morning-briefing',
      expect.any(Object),
    );
  });

  it('freshContext:true generates a unique contextId per run (not the bare contextId)', async () => {
    const mission = { ...sampleMission, freshContext: true };
    mockReadFileSync.mockReturnValue(missionsJson([mission]));
    startScheduler();
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    const calledContextId = mockRunAgent.mock.calls[0][1];
    expect(calledContextId).toMatch(/^mission-morning-briefing-\d+$/);
    expect(calledContextId).not.toBe('mission-morning-briefing');
  });

  it('passes maxIterations to runAgent when mission.maxIterations is set', async () => {
    const mission = { ...sampleMission, maxIterations: 15 };
    mockReadFileSync.mockReturnValue(missionsJson([mission]));
    startScheduler();
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    const calledOptions = mockRunAgent.mock.calls[0][2];
    expect(calledOptions).toMatchObject({ maxIterations: 15 });
  });

  it('does NOT include maxIterations in runAgent options when mission.maxIterations is not set', async () => {
    mockReadFileSync.mockReturnValue(missionsJson([sampleMission]));
    startScheduler();
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    const calledOptions = mockRunAgent.mock.calls[0][2];
    expect(calledOptions).not.toHaveProperty('maxIterations');
  });

  it('falls back to mission-<name> contextId when contextId is not set', async () => {
    const mission = { ...sampleMission, contextId: undefined };
    mockReadFileSync.mockReturnValue(missionsJson([mission]));
    startScheduler();
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.any(String),
      'mission-morning-briefing',
      expect.any(Object),
    );
  });

  it('defaults to UTC timezone when timezone is not set', () => {
    const mission = { ...sampleMission, timezone: undefined };
    mockReadFileSync.mockReturnValue(missionsJson([mission]));
    startScheduler();
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      { timezone: 'UTC' },
    );
  });
});

// ---------------------------------------------------------------------------
// startScheduler — cron callback behaviour
// ---------------------------------------------------------------------------
describe('startScheduler — cron callback', () => {
  async function runCronCallback(mission = sampleMission, notifyFn = null) {
    mockReadFileSync.mockReturnValue(missionsJson([mission]));
    startScheduler(notifyFn);
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
  }

  it('calls runAgent with the mission task and contextId', async () => {
    await runCronCallback();
    expect(mockRunAgent).toHaveBeenCalledWith(
      'Check the weather',
      'mission-morning-briefing',
      expect.any(Object),
    );
  });

  it('calls notify with channel + missionName + result when slackChannel is set', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await runCronCallback(sampleMission, notify);
    expect(notify).toHaveBeenCalledWith('C123', 'morning-briefing', 'Mission result text');
  });

  it('does NOT call notify when slackChannel is absent', async () => {
    const notify = vi.fn();
    const mission = { ...sampleMission, slackChannel: undefined };
    await runCronCallback(mission, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does NOT call notify when no notify function is passed', async () => {
    // Should not throw even without a notify function
    await expect(runCronCallback(sampleMission, null)).resolves.not.toThrow();
  });

  it('catches runAgent errors without propagating', async () => {
    mockRunAgent.mockRejectedValueOnce(new Error('Ollama offline'));
    await expect(runCronCallback()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// startScheduler — postLastThought
// ---------------------------------------------------------------------------
describe('startScheduler — postLastThought', () => {
  // Timestamp set 1 minute ahead so it always falls after the startTime
  // captured inside the cron callback (which runs synchronously in tests).
  const thoughtEntry = JSON.stringify({
    timestamp: new Date(Date.now() + 60_000).toISOString(),
    thought: 'An interesting autonomous thought.',
  });

  async function runWithPostLastThought(mission, readResult) {
    mockReadFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('.json')) {
        return missionsJson([mission]);
      }
      if (readResult instanceof Error) throw readResult;
      return readResult;
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    startScheduler(notify);
    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();
    return notify;
  }

  it('posts the recorded thought when postLastThought:true and a thought was written', async () => {
    const mission = { ...sampleMission, postLastThought: true };
    const notify = await runWithPostLastThought(mission, thoughtEntry);
    expect(notify).toHaveBeenCalledWith('C123', 'morning-briefing', 'An interesting autonomous thought.');
  });

  it('falls back to model response when postLastThought:true but no thought was written', async () => {
    const mission = { ...sampleMission, postLastThought: true };
    const notify = await runWithPostLastThought(mission, new Error('ENOENT'));
    expect(notify).toHaveBeenCalledWith('C123', 'morning-briefing', 'Mission result text');
  });

  it('posts model response when postLastThought is not set', async () => {
    const mission = { ...sampleMission };
    const notify = await runWithPostLastThought(mission, thoughtEntry);
    expect(notify).toHaveBeenCalledWith('C123', 'morning-briefing', 'Mission result text');
  });
});

// ---------------------------------------------------------------------------
// makeSchedulerCallbacks
// Each test uses vi.resetModules() + dynamic import to guarantee a fresh
// module instance with the exact config value it needs, avoiding any
// interaction between the module-level mock and restoreMocks: true.
// ---------------------------------------------------------------------------
// makeSchedulerCallbacks tests use vi.doMock() (not vi.mock()) because they run
// inside function bodies — vi.mock() is only hoisted at the top level. vi.doMock()
// is the correct non-hoisted API for use with vi.resetModules() + dynamic import().
describe('makeSchedulerCallbacks', () => {
  it('approves safe tools (requiresApproval=false) regardless of SCHEDULER_ALLOW_DANGEROUS', async () => {
    vi.resetModules();
    vi.doMock('../../config.js', () => ({
      default: { MISSIONS_PATH: '/tmp/missions.json', SCHEDULER_ALLOW_DANGEROUS: false },
    }));
    const { makeSchedulerCallbacks: mkCbs } = await import('../../scheduler/index.js');
    const approved = await mkCbs('test').onToolCall({ toolName: 'web_search', requiresApproval: false });
    expect(approved).toBe(true);
  });

  it('denies dangerous tools when SCHEDULER_ALLOW_DANGEROUS=false', async () => {
    vi.resetModules();
    vi.doMock('../../config.js', () => ({
      default: { MISSIONS_PATH: '/tmp/missions.json', SCHEDULER_ALLOW_DANGEROUS: false },
    }));
    const { makeSchedulerCallbacks: mkCbs } = await import('../../scheduler/index.js');
    const approved = await mkCbs('test').onToolCall({ toolName: 'run_command', requiresApproval: true });
    expect(approved).toBe(false);
  });

  it('approves dangerous tools when SCHEDULER_ALLOW_DANGEROUS=true', async () => {
    vi.resetModules();
    vi.doMock('../../config.js', () => ({
      default: { MISSIONS_PATH: '/tmp/missions.json', SCHEDULER_ALLOW_DANGEROUS: true },
    }));
    const { makeSchedulerCallbacks: mkCbs } = await import('../../scheduler/index.js');
    const approved = await mkCbs('test').onToolCall({ toolName: 'run_command', requiresApproval: true });
    expect(approved).toBe(true);
  });

  it('onToolResult does not throw', () => {
    expect(() => makeSchedulerCallbacks('test').onToolResult({ toolName: 'web_search', result: 'ok' })).not.toThrow();
  });
});
