import { describe, it, expect, vi, beforeEach } from 'vitest';
import { check } from '../../../monitors/types/file.js';

vi.mock('fs');
import fs from 'fs';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('file monitor — check()', () => {
  it('does not trigger on first check (no previousMtime)', () => {
    fs.statSync.mockReturnValueOnce({ mtimeMs: 1000 });
    const state = {};
    const result = check({ path: '/tmp/test.json' }, state);
    expect(result.triggered).toBe(false);
    expect(state.previousMtime).toBe(1000);
  });

  it('does not trigger when mtime is unchanged', () => {
    fs.statSync.mockReturnValueOnce({ mtimeMs: 1000 });
    const state = { previousMtime: 1000 };
    const result = check({ path: '/tmp/test.json' }, state);
    expect(result.triggered).toBe(false);
  });

  it('triggers when mtime has changed', () => {
    fs.statSync.mockReturnValueOnce({ mtimeMs: 2000 });
    const state = { previousMtime: 1000 };
    const result = check({ path: '/tmp/test.json' }, state);
    expect(result.triggered).toBe(true);
    expect(state.previousMtime).toBe(2000);
  });

  it('does not trigger when file does not exist (statSync throws)', () => {
    fs.statSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const state = { previousMtime: 1000 };
    const result = check({ path: '/tmp/missing.json' }, state);
    expect(result.triggered).toBe(false);
    expect(result.vars.error).toContain('ENOENT');
    // previousMtime should NOT be updated on error
    expect(state.previousMtime).toBe(1000);
  });

  it('includes path and mtime in vars', () => {
    fs.statSync.mockReturnValueOnce({ mtimeMs: 1700000000000 });
    const state = { previousMtime: 0 };
    const result = check({ path: '/etc/config.json' }, state);
    expect(result.vars.path).toBe('/etc/config.json');
    expect(result.vars.mtime).toMatch(/^\d{4}-/); // ISO date string
  });
});
