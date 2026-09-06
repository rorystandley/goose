import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));
const require = createRequire(import.meta.url);
const ecosystemPath = require.resolve('../../ecosystem.config.cjs');

afterEach(() => {
  vi.unstubAllEnvs();
  delete require.cache[ecosystemPath];
});

it.each([
  [undefined, 8100], ['', 8100], ['8200', 8200], ['65535', 65535],
  ['0', 8100], ['-1', 8100], ['65536', 8100], ['8100bad', 8100], ['8200.5', 8100],
])('keeps client and server ports aligned for %s', async (value, expected) => {
  vi.stubEnv('VLLM_PORT', value);
  vi.stubEnv('VLLM_HOST', '');
  vi.resetModules();
  const { default: config } = await import('../config.js');
  const server = require(ecosystemPath).apps.find(app => app.name === 'vllm');
  expect(config.VLLM_PORT).toBe(expected);
  expect(config.VLLM_HOST).toBe(`http://localhost:${expected}`);
  expect(server.args).toContain(`--port ${expected}`);
});

it('preserves an explicit remote API endpoint', async () => {
  vi.stubEnv('VLLM_PORT', '8200');
  vi.stubEnv('VLLM_HOST', 'https://inference.example.test');
  vi.resetModules();
  const { default: config } = await import('../config.js');
  expect(config.VLLM_HOST).toBe('https://inference.example.test');
});
