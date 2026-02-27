import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs (sync methods used by memory.js)
// ---------------------------------------------------------------------------
const mockReadFileSync  = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync     = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    readFileSync:  mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync:     mockMkdirSync,
  },
}));

vi.mock('../../config.js', () => ({
  default: { MEMORY_PATH: '/tmp/test-memory.json' },
}));

// ---------------------------------------------------------------------------
// Each test gets a fresh module instance (and therefore a fresh store) by
// calling vi.resetModules() then dynamically importing memory.js in beforeEach.
// ---------------------------------------------------------------------------
let getHistory;
let addMessage;
let clearHistory;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default: no existing file — load() catches the error and returns {}
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  ({ getHistory, addMessage, clearHistory } = await import('../../agent/memory.js'));
});

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------
describe('getHistory', () => {
  it('returns empty array for unknown contextId', () => {
    expect(getHistory('ch1')).toEqual([]);
  });

  it('returns messages that were added via addMessage', () => {
    addMessage('ch1', { role: 'user', content: 'hello' });
    expect(getHistory('ch1')).toHaveLength(1);
    expect(getHistory('ch1')[0]).toEqual({ role: 'user', content: 'hello' });
  });
});

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------
describe('addMessage', () => {
  it('saves to disk on every call', () => {
    addMessage('ch1', { role: 'user', content: 'hi' });
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('caps history at 20 messages', () => {
    for (let i = 0; i < 25; i++) {
      addMessage('ch1', { role: 'user', content: `msg ${i}` });
    }
    expect(getHistory('ch1')).toHaveLength(20);
  });

  it('keeps the most recent messages when capping', () => {
    for (let i = 0; i < 25; i++) {
      addMessage('ch1', { role: 'user', content: `msg ${i}` });
    }
    const history = getHistory('ch1');
    expect(history[0].content).toBe('msg 5');
    expect(history[19].content).toBe('msg 24');
  });

  it('exactly 20 messages does NOT drop any', () => {
    for (let i = 0; i < 20; i++) {
      addMessage('ch1', { role: 'user', content: `msg ${i}` });
    }
    expect(getHistory('ch1')).toHaveLength(20);
    expect(getHistory('ch1')[0].content).toBe('msg 0');
  });

  it('stores messages independently per contextId', () => {
    addMessage('ch1', { role: 'user', content: 'for ch1' });
    addMessage('ch2', { role: 'user', content: 'for ch2' });
    expect(getHistory('ch1')).toHaveLength(1);
    expect(getHistory('ch2')).toHaveLength(1);
  });

  it('writes valid JSON to the configured MEMORY_PATH', () => {
    addMessage('ch1', { role: 'assistant', content: 'pong' });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/test-memory.json',
      expect.stringContaining('"pong"'),
      'utf8'
    );
  });

  it('creates the parent directory before writing', () => {
    addMessage('ch1', { role: 'user', content: 'hi' });
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp', { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// clearHistory
// ---------------------------------------------------------------------------
describe('clearHistory', () => {
  it('empties the history for the given contextId', () => {
    addMessage('ch1', { role: 'user', content: 'hi' });
    clearHistory('ch1');
    expect(getHistory('ch1')).toEqual([]);
  });

  it('saves to disk after clearing', () => {
    addMessage('ch1', { role: 'user', content: 'hi' });
    vi.clearAllMocks();
    clearHistory('ch1');
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('does not affect other contexts', () => {
    addMessage('ch1', { role: 'user', content: 'hi' });
    addMessage('ch2', { role: 'user', content: 'there' });
    clearHistory('ch1');
    expect(getHistory('ch2')).toHaveLength(1);
  });

  it('does not throw when clearing a context that has no history', () => {
    expect(() => clearHistory('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// load() — persistence across restarts
// ---------------------------------------------------------------------------
describe('load()', () => {
  it('starts with an empty store when the file does not exist', () => {
    // mockReadFileSync already throws ENOENT — load() should return {}
    expect(getHistory('any-context')).toEqual([]);
  });

  it('pre-populates history from an existing memory file', async () => {
    const existing = {
      'ch-old': [{ role: 'user', content: 'remembered across restarts' }],
    };
    vi.resetModules();
    // This mock is consumed by the module-init load() call inside the import below
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(existing));
    const { getHistory: getH } = await import('../../agent/memory.js');
    expect(getH('ch-old')).toEqual([{ role: 'user', content: 'remembered across restarts' }]);
  });

  it('starts fresh when the file contains invalid JSON', async () => {
    vi.resetModules();
    mockReadFileSync.mockReturnValueOnce('not valid json {{{{');
    const { getHistory: getH } = await import('../../agent/memory.js');
    expect(getH('any-context')).toEqual([]);
  });
});
