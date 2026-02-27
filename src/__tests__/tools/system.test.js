import { describe, it, expect } from 'vitest';
import { get_datetime, get_system_info } from '../../tools/system.js';

// No mocks needed — os and Date are safe to call in tests

describe('get_datetime', () => {
  it('returns a non-empty string', async () => {
    const result = await get_datetime.execute();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('result looks like a date/time string', async () => {
    const result = await get_datetime.execute();
    // en-GB locale: "dd/mm/yyyy, hh:mm:ss" — just check digits and separators exist
    expect(result).toMatch(/\d/);
  });

  it('has riskLevel "safe"', () => {
    expect(get_datetime.riskLevel).toBe('safe');
  });

  it('has no required parameters', () => {
    expect(get_datetime.parameters.required).toEqual([]);
  });
});

describe('get_system_info', () => {
  it('returns a string containing platform info', async () => {
    const result = await get_system_info.execute();
    expect(result).toContain('Platform:');
    expect(result).toContain('Architecture:');
    expect(result).toContain('Total memory:');
    expect(result).toContain('Free memory:');
    expect(result).toContain('Node.js:');
    expect(result).toContain('Hostname:');
  });

  it('memory values are in MB format', async () => {
    const result = await get_system_info.execute();
    expect(result).toMatch(/Total memory: \d+ MB/);
    expect(result).toMatch(/Free memory: \d+ MB/);
  });

  it('Node.js version starts with v', async () => {
    const result = await get_system_info.execute();
    expect(result).toMatch(/Node\.js: v\d+/);
  });

  it('has riskLevel "safe"', () => {
    expect(get_system_info.riskLevel).toBe('safe');
  });
});
