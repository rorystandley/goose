import { describe, it, expect, vi, beforeEach } from 'vitest';
import { check, getCpuPercent, getMemoryPercent } from '../../../monitors/types/system.js';

vi.mock('os');
import os from 'os';

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to build a fake CPU array
function makeCpus(idlePct) {
  // total = 1000 ticks, idle = idlePct * 10
  const idle = idlePct * 10;
  const user = 1000 - idle;
  return [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
}

describe('getCpuPercent()', () => {
  it('returns 0% when 100% idle', () => {
    os.cpus.mockReturnValueOnce(makeCpus(100));
    expect(getCpuPercent()).toBe(0);
  });

  it('returns 100% when 0% idle', () => {
    os.cpus.mockReturnValueOnce(makeCpus(0));
    expect(getCpuPercent()).toBe(100);
  });

  it('returns ~80% when 20% idle', () => {
    os.cpus.mockReturnValueOnce(makeCpus(20));
    expect(getCpuPercent()).toBe(80);
  });
});

describe('getMemoryPercent()', () => {
  it('returns 50% when half of memory is used', () => {
    os.totalmem.mockReturnValueOnce(1000);
    os.freemem.mockReturnValueOnce(500);
    expect(getMemoryPercent()).toBe(50);
  });

  it('returns 90% when 90% of memory is used', () => {
    os.totalmem.mockReturnValueOnce(1000);
    os.freemem.mockReturnValueOnce(100);
    expect(getMemoryPercent()).toBe(90);
  });
});

describe('system monitor — check()', () => {
  it('triggers when cpu exceeds threshold', () => {
    os.cpus.mockReturnValueOnce(makeCpus(10)); // 90% usage
    const result = check({ metric: 'cpu', threshold: 85 });
    expect(result.triggered).toBe(true);
    expect(result.vars.metric).toBe('cpu');
    expect(result.vars.value).toBe('90');
    expect(result.vars.threshold).toBe('85');
  });

  it('does not trigger when cpu is below threshold', () => {
    os.cpus.mockReturnValueOnce(makeCpus(80)); // 20% usage
    const result = check({ metric: 'cpu', threshold: 85 });
    expect(result.triggered).toBe(false);
  });

  it('triggers when memory exceeds threshold', () => {
    os.totalmem.mockReturnValueOnce(1000);
    os.freemem.mockReturnValueOnce(50); // 95% usage
    const result = check({ metric: 'memory', threshold: 90 });
    expect(result.triggered).toBe(true);
    expect(result.vars.value).toBe('95');
  });

  it('does not trigger when memory is below threshold', () => {
    os.totalmem.mockReturnValueOnce(1000);
    os.freemem.mockReturnValueOnce(500); // 50% usage
    const result = check({ metric: 'memory', threshold: 90 });
    expect(result.triggered).toBe(false);
  });

  it('does not trigger for unknown metric', () => {
    const result = check({ metric: 'disk', threshold: 80 });
    expect(result.triggered).toBe(false);
  });
});
