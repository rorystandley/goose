import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('fs');
vi.mock('../../agent/loop.js', () => ({ runAgent: vi.fn().mockResolvedValue('agent result') }));
const mockSpeak = vi.hoisted(() => vi.fn());
vi.mock('../../interfaces/voice/tts.js', () => ({ speak: mockSpeak }));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../../config.js', () => ({
  default: {
    MONITORS_PATH: '/fake/monitors.json',
    MONITORS_ALLOW_DANGEROUS: false,
  },
}));

import fs from 'fs';
import { runAgent } from '../../agent/loop.js';
import {
  parseInterval,
  interpolate,
  loadMonitors,
  startMonitors,
  stopMonitors,
  makeMonitorCallbacks,
} from '../../monitors/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monitorsJson(monitors) {
  return JSON.stringify({ monitors });
}

const baseMonitor = {
  name: 'test-monitor',
  type: 'system',
  metric: 'cpu',
  threshold: 0, // always triggers (any CPU > 0%)
  interval: '100ms', // very short for tests
  cooldown: '1ms',   // very short so we can trigger multiple times
  task: 'CPU is at {value}%',
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fs.readFileSync.mockReturnValue(monitorsJson([baseMonitor]));
  // Re-apply after clearAllMocks (Vitest 2.x resets mock implementations)
  runAgent.mockResolvedValue('agent result');
  mockSpeak.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// parseInterval
// ---------------------------------------------------------------------------

describe('parseInterval()', () => {
  it('parses milliseconds: "100ms" → 100', () => expect(parseInterval('100ms')).toBe(100));
  it('parses seconds: "30s" → 30000', () => expect(parseInterval('30s')).toBe(30_000));
  it('parses minutes: "5m" → 300000', () => expect(parseInterval('5m')).toBe(300_000));
  it('parses hours: "2h" → 7200000', () => expect(parseInterval('2h')).toBe(7_200_000));
  it('parses days: "1d" → 86400000', () => expect(parseInterval('1d')).toBe(86_400_000));
  it('defaults to minutes when no unit: "10" → 600000', () => expect(parseInterval('10')).toBe(600_000));
  it('passes through number values directly', () => expect(parseInterval(5000)).toBe(5000));
  it('defaults to 5 minutes for invalid input', () => expect(parseInterval('invalid')).toBe(300_000));
  it('handles decimal: "1.5m" → 90000', () => expect(parseInterval('1.5m')).toBe(90_000));
});

// ---------------------------------------------------------------------------
// interpolate
// ---------------------------------------------------------------------------

describe('interpolate()', () => {
  it('replaces known placeholders', () => {
    expect(interpolate('CPU is {value}% (threshold: {threshold}%)', { value: '90', threshold: '85' }))
      .toBe('CPU is 90% (threshold: 85%)');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(interpolate('URL: {url} status: {status}', { url: 'https://x.com' }))
      .toBe('URL: https://x.com status: {status}');
  });

  it('handles template with no placeholders', () => {
    expect(interpolate('hello world', {})).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// loadMonitors
// ---------------------------------------------------------------------------

describe('loadMonitors()', () => {
  it('returns monitors array from valid JSON', () => {
    const monitors = loadMonitors();
    expect(monitors).toHaveLength(1);
    expect(monitors[0].name).toBe('test-monitor');
  });

  it('returns empty array when file does not exist', () => {
    fs.readFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    expect(loadMonitors()).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    fs.readFileSync.mockReturnValueOnce('{ broken json');
    expect(loadMonitors()).toEqual([]);
  });

  it('returns empty array when monitors key is missing', () => {
    fs.readFileSync.mockReturnValueOnce(JSON.stringify({ other: [] }));
    expect(loadMonitors()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// makeMonitorCallbacks — dangerous tool handling
// ---------------------------------------------------------------------------

describe('makeMonitorCallbacks()', () => {
  it('allows safe tools', async () => {
    const { onToolCall } = makeMonitorCallbacks('test');
    const allowed = await onToolCall({ toolName: 'web_search', requiresApproval: false });
    expect(allowed).toBe(true);
  });

  it('denies dangerous tools by default (MONITORS_ALLOW_DANGEROUS=false)', async () => {
    const { onToolCall } = makeMonitorCallbacks('test');
    const allowed = await onToolCall({ toolName: 'run_command', requiresApproval: true });
    expect(allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startMonitors / stopMonitors
// ---------------------------------------------------------------------------

describe('startMonitors()', () => {
  it('returns empty array when no monitors file exists', () => {
    fs.readFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const ids = startMonitors();
    expect(ids).toEqual([]);
  });

  it('skips disabled monitors', () => {
    fs.readFileSync.mockReturnValueOnce(monitorsJson([{ ...baseMonitor, enabled: false }]));
    const ids = startMonitors();
    expect(ids).toHaveLength(0);
  });

  it('skips monitors with unknown type', () => {
    fs.readFileSync.mockReturnValueOnce(monitorsJson([{ ...baseMonitor, type: 'unknown' }]));
    const ids = startMonitors();
    expect(ids).toHaveLength(0);
  });

  it('starts an interval for each enabled monitor', () => {
    const ids = startMonitors();
    expect(ids).toHaveLength(1);
    stopMonitors(ids);
  });

  it('calls runAgent when monitor triggers', async () => {
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(200); // let interval fire
    expect(runAgent).toHaveBeenCalled();
    stopMonitors(ids);
  });

  it('calls notify with slackChannel when provided', async () => {
    const monitor = { ...baseMonitor, slackChannel: 'C123' };
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const notify = vi.fn();
    const ids = startMonitors(notify);
    await vi.advanceTimersByTimeAsync(200);
    expect(notify).toHaveBeenCalledWith('C123', 'test-monitor', 'agent result');
    stopMonitors(ids);
  });

  it('does not call notify when slackChannel is not set', async () => {
    const monitor = { ...baseMonitor };
    delete monitor.slackChannel;
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const notify = vi.fn();
    const ids = startMonitors(notify);
    await vi.advanceTimersByTimeAsync(200);
    expect(notify).not.toHaveBeenCalled();
    stopMonitors(ids);
  });

  it('interpolates task template before passing to runAgent', async () => {
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(200);
    const taskArg = runAgent.mock.calls[0][0];
    // task was 'CPU is at {value}%' — should have value substituted
    expect(taskArg).toMatch(/CPU is at \d+%/);
    stopMonitors(ids);
  });

  it('speaks monitor output when speakOnFailure is enabled and the monitor triggers', async () => {
    const monitor = { ...baseMonitor, speakOnFailure: true };
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(200);
    expect(mockSpeak).toHaveBeenCalledWith('agent result', expect.objectContaining({
      source: 'monitor',
      monitorName: 'test-monitor',
    }));
    stopMonitors(ids);
  });

  it('does not speak monitor output by default', async () => {
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(200);
    expect(mockSpeak).not.toHaveBeenCalled();
    stopMonitors(ids);
  });

  it('speaks a monitor agent failure summary when speakOnFailure is enabled', async () => {
    runAgent.mockRejectedValueOnce(new Error('LLM offline'));
    const monitor = { ...baseMonitor, speakOnFailure: true };
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(200);
    expect(mockSpeak).toHaveBeenCalledWith(
      'Goose monitor test-monitor failed: LLM offline',
      expect.objectContaining({ source: 'monitor', monitorName: 'test-monitor', mode: 'agent-failure' }),
    );
    stopMonitors(ids);
  });

  it('does not let speech failures break monitor handling', async () => {
    mockSpeak.mockRejectedValueOnce(new Error('TTS offline'));
    const monitor = { ...baseMonitor, speakOnFailure: true };
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const ids = startMonitors();
    await expect(vi.advanceTimersByTimeAsync(200)).resolves.not.toThrow();
    stopMonitors(ids);
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('cooldown', () => {
  it('suppresses triggers during cooldown window', async () => {
    const monitor = { ...baseMonitor, cooldown: '1h' }; // very long cooldown
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const ids = startMonitors();
    // Fire multiple times — should only call runAgent once
    await vi.advanceTimersByTimeAsync(500);
    expect(runAgent).toHaveBeenCalledTimes(1);
    stopMonitors(ids);
  });

  it('allows triggers again after cooldown expires', async () => {
    const monitor = { ...baseMonitor, cooldown: '50ms', interval: '100ms' };
    fs.readFileSync.mockReturnValueOnce(monitorsJson([monitor]));
    const ids = startMonitors();
    await vi.advanceTimersByTimeAsync(300);
    expect(runAgent.mock.calls.length).toBeGreaterThan(1);
    stopMonitors(ids);
  });
});

// ---------------------------------------------------------------------------
// stopMonitors
// ---------------------------------------------------------------------------

describe('stopMonitors()', () => {
  it('clears all intervals, preventing further triggers', async () => {
    const ids = startMonitors();
    stopMonitors(ids);
    await vi.advanceTimersByTimeAsync(500);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('is safe to call with empty array', () => {
    expect(() => stopMonitors([])).not.toThrow();
  });
});
