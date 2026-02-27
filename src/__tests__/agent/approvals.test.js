import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApproval, resolveApproval, hasPending } from '../../agent/approvals.js';

beforeEach(() => {
  vi.useFakeTimers();
});

describe('createApproval', () => {
  it('returns an id (UUID string) and a promise', () => {
    const { id, promise } = createApproval({ tool: 'run_command', args: { command: 'ls' } });
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(promise).toBeInstanceOf(Promise);
    // Resolve so we don't leave dangling timers
    resolveApproval(id, true);
  });

  it('marks the approval as pending immediately after creation', () => {
    const { id } = createApproval({ tool: 'write_file', args: {} });
    expect(hasPending(id)).toBe(true);
    resolveApproval(id, true);
  });

  it('each call generates a unique id', () => {
    const a = createApproval({ tool: 'run_command', args: {} });
    const b = createApproval({ tool: 'run_command', args: {} });
    expect(a.id).not.toBe(b.id);
    resolveApproval(a.id, true);
    resolveApproval(b.id, true);
  });
});

describe('resolveApproval — approved', () => {
  it('promise resolves to true when approved', async () => {
    const { id, promise } = createApproval({ tool: 'run_command', args: {} });
    resolveApproval(id, true);
    await expect(promise).resolves.toBe(true);
  });

  it('removes approval from pending map after resolving', async () => {
    const { id, promise } = createApproval({ tool: 'run_command', args: {} });
    resolveApproval(id, true);
    await promise;
    expect(hasPending(id)).toBe(false);
  });
});

describe('resolveApproval — denied', () => {
  it('promise resolves to false when denied', async () => {
    const { id, promise } = createApproval({ tool: 'write_file', args: {} });
    resolveApproval(id, false);
    await expect(promise).resolves.toBe(false);
  });
});

describe('resolveApproval — unknown id', () => {
  it('does not throw for an unknown approval id', () => {
    expect(() => resolveApproval('nonexistent-id', true)).not.toThrow();
  });
});

describe('auto-deny timeout', () => {
  it('resolves to false after 5 minutes with no response', async () => {
    const { id, promise } = createApproval({ tool: 'run_command', args: {} });
    expect(hasPending(id)).toBe(true);

    // Advance time past the 5-minute timeout
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(promise).resolves.toBe(false);
    expect(hasPending(id)).toBe(false);
  });

  it('does NOT auto-deny before 5 minutes elapse', async () => {
    const { id } = createApproval({ tool: 'run_command', args: {} });
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes — not yet
    expect(hasPending(id)).toBe(true);
    // Clean up
    resolveApproval(id, true);
  });
});

describe('hasPending', () => {
  it('returns false for an id that was never created', () => {
    expect(hasPending('random-unknown-uuid')).toBe(false);
  });
});
