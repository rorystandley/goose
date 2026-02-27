import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available before module imports
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
  default: { FACTS_PATH: '/tmp/test-facts.json' },
}));

// Logger mock — suppress output in tests
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let getFacts, setFact, getFactsAsText;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default: no existing facts file
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  ({ getFacts, setFact, getFactsAsText } = await import('../../agent/facts.js'));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getFacts', () => {
  it('returns {} when the facts file does not exist', () => {
    expect(getFacts()).toEqual({});
  });

  it('returns parsed facts when the file exists', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Alex', location: 'London' }));
    vi.resetModules();
    ({ getFacts } = await import('../../agent/facts.js'));
    expect(getFacts()).toEqual({ name: 'Alex', location: 'London' });
  });

  it('returns {} when the file contains invalid JSON', async () => {
    mockReadFileSync.mockReturnValue('not valid json {{');
    vi.resetModules();
    ({ getFacts } = await import('../../agent/facts.js'));
    expect(getFacts()).toEqual({});
  });

  it('returns a copy — mutating the result does not affect the internal store', () => {
    const copy = getFacts();
    copy.injected = 'yes';
    expect(getFacts()).not.toHaveProperty('injected');
  });
});

describe('setFact', () => {
  it('adds a new fact and persists to disk', () => {
    setFact('name', 'Alex');
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written).toHaveProperty('name', 'Alex');
  });

  it('overwrites an existing fact', () => {
    setFact('name', 'Alex');
    setFact('name', 'Alex Smith');
    const written = JSON.parse(mockWriteFileSync.mock.calls.at(-1)[1]);
    expect(written.name).toBe('Alex Smith');
  });

  it('calls mkdirSync before writeFileSync', () => {
    setFact('key', 'value');
    const mkdirOrder  = mockMkdirSync.mock.invocationCallOrder[0];
    const writeOrder  = mockWriteFileSync.mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(writeOrder);
  });

  it('does not throw when writeFileSync fails', () => {
    mockWriteFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => setFact('key', 'value')).not.toThrow();
  });

  it('reflects the new fact in getFacts() immediately', () => {
    setFact('hardware', 'desktop');
    expect(getFacts()).toHaveProperty('hardware', 'desktop');
  });
});

describe('getFactsAsText', () => {
  it('returns null when no facts have been stored', () => {
    expect(getFactsAsText()).toBeNull();
  });

  it('returns a bullet-list string when facts exist', () => {
    setFact('name', 'Alex');
    setFact('location', 'London');
    const text = getFactsAsText();
    expect(text).toContain('- name: Alex');
    expect(text).toContain('- location: London');
  });

  it('each fact is on its own line', () => {
    setFact('a', '1');
    setFact('b', '2');
    const lines = getFactsAsText().split('\n');
    expect(lines).toHaveLength(2);
  });
});
