import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the facts module so we don't touch the filesystem
// ---------------------------------------------------------------------------

const mockSetFact = vi.hoisted(() => vi.fn());

vi.mock('../../agent/facts.js', () => ({
  setFact: mockSetFact,
}));

import { remember_fact } from '../../tools/facts.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('remember_fact', () => {
  it('returns "Remembered." on success', async () => {
    const result = await remember_fact.execute({ key: 'name', value: 'Alex' });
    expect(result).toBe('Remembered.');
  });

  it('calls setFact with the correct key and value', async () => {
    await remember_fact.execute({ key: 'location', value: 'London' });
    expect(mockSetFact).toHaveBeenCalledOnce();
    expect(mockSetFact).toHaveBeenCalledWith('location', 'London');
  });

  it('returns "Remembered." even when setFact throws (silent failure)', async () => {
    mockSetFact.mockImplementationOnce(() => { throw new Error('disk full'); });
    const result = await remember_fact.execute({ key: 'key', value: 'val' });
    expect(result).toBe('Remembered.');
  });

  it('has riskLevel "safe"', () => {
    expect(remember_fact.riskLevel).toBe('safe');
  });

  it('requires both key and value parameters', () => {
    expect(remember_fact.parameters.required).toContain('key');
    expect(remember_fact.parameters.required).toContain('value');
  });
});
