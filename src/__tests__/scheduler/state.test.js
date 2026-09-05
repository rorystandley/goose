import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadRun = vi.hoisted(() => vi.fn(() => null));
vi.mock('../../execution/store.js', () => ({ readRun: mockReadRun }));

const mockBroadcast = vi.hoisted(() => vi.fn());
vi.mock('../../interfaces/web/sse.js', () => ({
  broadcast: mockBroadcast,
}));

const {
  recordMissionStart,
  recordMissionComplete,
  recordMissionFailed,
  getMissionState,
  getAllMissionStates,
  resetState,
} = await import('../../scheduler/state.js');

beforeEach(() => {
  resetState();
  mockReadRun.mockReset();
  mockReadRun.mockReturnValue(null);
  mockBroadcast.mockClear();
});

describe('scheduler/state', () => {
  it('getMissionState returns idle default for unknown mission', () => {
    expect(getMissionState('nope')).toMatchObject({
      name: 'nope',
      status: 'idle',
      lastRun: null,
      lastError: null,
    });
  });

  it('recordMissionStart sets status=running and broadcasts', () => {
    recordMissionStart('morning-briefing');
    const s = getMissionState('morning-briefing');
    expect(s.status).toBe('running');
    expect(s.startedAt).toBeTruthy();
    expect(mockBroadcast).toHaveBeenCalledWith('missionStateChanged', expect.objectContaining({
      name: 'morning-briefing',
      status: 'running',
    }));
  });

  it('recordMissionComplete sets status=completed, lastRun, lastDuration', () => {
    recordMissionStart('m1');
    recordMissionComplete('m1', { durationMs: 1234 });
    const s = getMissionState('m1');
    expect(s.status).toBe('completed');
    expect(s.lastRun).toBeTruthy();
    expect(s.lastDuration).toBe(1234);
    expect(s.lastError).toBeNull();
    expect(mockBroadcast).toHaveBeenLastCalledWith('missionStateChanged', expect.objectContaining({
      name: 'm1',
      status: 'completed',
      lastDuration: 1234,
    }));
  });

  it('recordMissionFailed sets status=failed and stores error', () => {
    recordMissionStart('m2');
    recordMissionFailed('m2', { error: 'Ollama offline', durationMs: 50 });
    const s = getMissionState('m2');
    expect(s.status).toBe('failed');
    expect(s.lastError).toBe('Ollama offline');
    expect(s.lastDuration).toBe(50);
    expect(mockBroadcast).toHaveBeenLastCalledWith('missionStateChanged', expect.objectContaining({
      name: 'm2',
      status: 'failed',
      lastError: 'Ollama offline',
    }));
  });

  it('getAllMissionStates returns one entry per observed mission', () => {
    recordMissionStart('a');
    recordMissionStart('b');
    recordMissionComplete('a', { durationMs: 100 });
    const all = getAllMissionStates();
    expect(all).toHaveLength(2);
    expect(all.find(s => s.name === 'a').status).toBe('completed');
    expect(all.find(s => s.name === 'b').status).toBe('running');
  });

  it('resetState clears all tracked missions', () => {
    recordMissionStart('a');
    resetState();
    expect(getAllMissionStates()).toEqual([]);
  });
});


it('does not replace a new running state with the previous persisted completion', () => {
  mockReadRun.mockReturnValue({ status: 'completed', startedAt: '2020-01-01T00:00:00.000Z', finishedAt: '2020-01-01T00:01:00.000Z' });
  recordMissionStart('m1');
  expect(getMissionState('m1').status).toBe('running');
});
