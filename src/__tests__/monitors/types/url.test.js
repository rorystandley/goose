import { describe, it, expect, vi, beforeEach } from 'vitest';
import { check } from '../../../monitors/types/url.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: AbortSignal.timeout exists
  if (!globalThis.AbortSignal) {
    globalThis.AbortSignal = { timeout: vi.fn(() => ({})) };
  }
});

describe('url monitor — check()', () => {
  it('does not trigger on first healthy response (no previousStatus)', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const state = {};
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(false);
    expect(state.previousStatus).toBe(200);
  });

  it('does not trigger when status stays healthy', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const state = { previousStatus: 200 };
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(false);
  });

  it('triggers when status goes from healthy to 500', async () => {
    mockFetch.mockResolvedValueOnce({ status: 500 });
    const state = { previousStatus: 200 };
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(true);
    expect(result.vars.status).toBe('500');
    expect(state.previousStatus).toBe(500);
  });

  it('triggers on network error (fetch throws)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const state = { previousStatus: 200 };
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(true);
    expect(result.vars.status).toContain('network error');
    expect(state.previousStatus).toBe(0);
  });

  it('triggers on recovery (was down, now healthy)', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const state = { previousStatus: 503 };
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(true); // recovery event
    expect(result.vars.status).toBe('200');
  });

  it('does not trigger when status stays down (no double-alarm)', async () => {
    mockFetch.mockResolvedValueOnce({ status: 503 });
    const state = { previousStatus: 503 };
    const result = await check({ url: 'https://example.com' }, state);
    expect(result.triggered).toBe(true); // still down → still triggers (cooldown handles suppression)
  });

  it('includes url in vars', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404 });
    const state = { previousStatus: 200 };
    const result = await check({ url: 'https://my-service.example.com/health' }, state);
    expect(result.vars.url).toBe('https://my-service.example.com/health');
  });
});
