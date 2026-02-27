import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAppendFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync      = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    appendFileSync: mockAppendFileSync,
    mkdirSync:      mockMkdirSync,
  },
}));

vi.mock('../../config.js', () => ({
  default: {
    THOUGHTS_PATH: '/tmp/test-thoughts.jsonl',
  },
}));

// Import after mocks are in place
import { record_thought } from '../../tools/reflect.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('record_thought', () => {
  it('returns "Noted." on success', async () => {
    const result = await record_thought.execute({ thought: 'An interesting idea.' });
    expect(result).toBe('Noted.');
  });

  it('calls appendFileSync with the configured THOUGHTS_PATH', async () => {
    await record_thought.execute({ thought: 'Testing the path.' });
    expect(mockAppendFileSync).toHaveBeenCalledOnce();
    expect(mockAppendFileSync.mock.calls[0][0]).toBe('/tmp/test-thoughts.jsonl');
  });

  it('appended content is valid JSON with timestamp and thought fields', async () => {
    await record_thought.execute({ thought: 'A valid JSON thought.' });
    const written = mockAppendFileSync.mock.calls[0][1];
    // Strip the trailing newline
    const parsed = JSON.parse(written.trim());
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('thought', 'A valid JSON thought.');
    // timestamp should be an ISO 8601 string
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
  });

  it('includes optional context field when provided, omits it when absent', async () => {
    // With context
    await record_thought.execute({ thought: 'Context test.', context: 'disk-check mission' });
    const withContext = JSON.parse(mockAppendFileSync.mock.calls[0][1].trim());
    expect(withContext).toHaveProperty('context', 'disk-check mission');

    vi.clearAllMocks();

    // Without context
    await record_thought.execute({ thought: 'No context.' });
    const withoutContext = JSON.parse(mockAppendFileSync.mock.calls[0][1].trim());
    expect(withoutContext).not.toHaveProperty('context');
  });

  it('returns "Noted." silently even when appendFileSync throws', async () => {
    mockAppendFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
    const result = await record_thought.execute({ thought: 'Should not throw.' });
    expect(result).toBe('Noted.');
  });

  it('has riskLevel "safe"', () => {
    expect(record_thought.riskLevel).toBe('safe');
  });
});
