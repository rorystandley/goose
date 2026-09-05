import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const config = vi.hoisted(() => ({}));
const runAgent = vi.hoisted(() => vi.fn());
vi.mock('../../config.js', () => ({ default: config }));
vi.mock('../../agent/loop.js', () => ({ runAgent }));
vi.mock('../../tools/index.js', () => ({ initTools: async () => {}, toolMap: {
  read_file: { name: 'read_file', description: 'Read', parameters: {} },
  write_file: { name: 'write_file', description: 'Write', parameters: {} },
} }));
import { isToolFailure } from '../../execution/tool-result.js';
import { executeWorkflow } from '../../execution/workflow.js';
import { resolveMissionTools } from '../../scheduler/index.js';
import { validateCriteria } from '../../execution/verify.js';
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-readiness-'));
  config.RUNS_PATH = path.join(dir, 'runs');
  runAgent.mockReset(); runAgent.mockResolvedValue({ status: 'completed', result: 'draft ready' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('mission readiness', () => {
  it.each(['Search failed: HTTP 401', 'Backup failed during copy: denied', 'Twitter API error 403: forbidden',
    'Rate limited by Twitter. Resets at: 12:00', 'web_search is not configured. Add a key',
    'Backup saved to /tmp/snapshot but pruning failed: denied'])('recognises real tool failure envelope: %s', value => {
    expect(isToolFailure(value)).toBe(true);
  });
  it.each(['Backup complete: 2026-09-05', 'Search results for "error handling":', 'No results found for: test'])('does not reject valid tool output: %s', value => {
    expect(isToolFailure(value)).toBe(false);
  });
  it('does not execute a product workflow with stale research', async () => {
    const file = path.join(dir, 'research.md'); fs.writeFileSync(file, 'source data');
    const old = new Date(Date.now() - 72 * 3600000); fs.utimesSync(file, old, old);
    const result = await executeWorkflow({ id: 'product', definition: {},
      inputs: [{ type: 'file', path: file, maxAgeHours: 48 }],
      stages: [{ name: 'design', task: 'Design a product', contextId: 'test' }],
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'input_verification_failed' });
    expect(result.result).toContain('older than 48 hours');
    expect(runAgent).not.toHaveBeenCalled();
  });
  it('accepts fresh research and records a successful run', async () => {
    const file = path.join(dir, 'research.md'); fs.writeFileSync(file, 'source data');
    const result = await executeWorkflow({ id: 'product', definition: {},
      inputs: [{ type: 'file', path: file, maxAgeHours: 48 }],
      stages: [{ name: 'design', task: 'Design a product', contextId: 'test' }],
    });
    expect(result.status).toBe('completed'); expect(runAgent).toHaveBeenCalledTimes(1);
  });
  it('fails a direct backup error instead of marking it completed', async () => {
    const result = await executeWorkflow({ id: 'backup', definition: {},
      stages: [{ name: 'backup', direct: async () => 'Backup failed: cannot create snapshot' }],
    });
    expect(result).toMatchObject({ status: 'failed', reason: 'tool_error' });
  });
  it('rejects invalid freshness limits', () => {
    expect(() => validateCriteria([{ type: 'file', path: '/tmp/input', maxAgeHours: -1 }])).toThrow();
  });
  it('limits tools and rejects missing dependencies before execution', () => {
    expect(Object.keys(resolveMissionTools({ allowedTools: ['read_file'] }).subAgentTools.toolMap)).toEqual(['read_file']);
    expect(() => resolveMissionTools({ allowedTools: ['reddit_search'] })).toThrow('installed tool names');
    expect(resolveMissionTools({ noTools: true }).subAgentTools.toolDefinitions).toEqual([]);
  });
});
