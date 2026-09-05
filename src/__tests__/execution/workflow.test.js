import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const config = vi.hoisted(() => ({ MAX_TOOL_ITERATIONS: 5, REQUIRE_APPROVAL: true, AGENT_NAME: 'TestGoose' }));
const chat = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
const history = vi.hoisted(() => new Map());
vi.mock('../../config.js', () => ({ default: config }));
vi.mock('../../agent/router.js', () => ({ selectModel: async () => 'test' }));
vi.mock('../../agent/facts.js', () => ({ getFactsAsText: () => '' }));
vi.mock('../../agent/memory.js', () => ({
  addMessage: (id, msg) => history.set(id, [...(history.get(id) ?? []), msg]),
  getHistory: id => history.get(id) ?? [],
}));
vi.mock('../../agent/llm.js', () => ({ chat,
  makeToolResultMessage: (id, content) => ({ role: 'tool', content, tool_call_id: id }),
}));
vi.mock('../../tools/index.js', () => ({ getToolDefinitions: () => [], toolMap: {
  write: { riskLevel: 'dangerous', execute: write },
  read: { riskLevel: 'safe', execute: read },
} }));
import { executeWorkflow } from '../../execution/workflow.js';
import { acquireRun, readRun, writeRun, fingerprint } from '../../execution/store.js';
import { runAgent } from '../../agent/loop.js';
import { snapshotArtifacts, verifyArtifacts } from '../../execution/verify.js';

const text = content => ({ content, rawAssistantMessage: { role: 'assistant', content } });
const calls = (...names) => ({ toolCalls: names.map((name, i) => ({ name, arguments: {}, id: `${i}` })),
  rawAssistantMessage: { role: 'assistant', tool_calls: names.map((name, i) => ({ id: `${i}`, function: { name, arguments: {} } })) } });
const spec = (extra = {}) => ({ id: 'job', definition: { task: 'make report' },
  stages: [{ name: 'work', task: 'make report', contextId: 'test', options: { onToolCall: async () => true } }], retryDelayMs: 0, ...extra });
let dir;
beforeEach(() => {
  vi.resetAllMocks(); history.clear();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-execution-'));
  config.RUNS_PATH = path.join(dir, 'runs');
  write.mockResolvedValue('saved'); read.mockResolvedValue('research');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('real loop + durable workflow', () => {
  it('retries transient inference failure without repeating completed tools', async () => {
    chat.mockResolvedValueOnce(calls('write')).mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(text('finished'));
    const result = await executeWorkflow(spec());
    expect(result.status).toBe('completed');
    expect(write).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[2][0].messages).toContainEqual(expect.objectContaining({ role: 'tool', content: 'saved' }));
    expect(readRun('job').status).toBe('completed');
  });
  it('caps retries and never marks an offline model completed', async () => {
    chat.mockRejectedValue(new Error('Connection refused'));
    const result = await executeWorkflow(spec());
    expect(result.status).toBe('failed');
    expect(chat).toHaveBeenCalledTimes(3);
  });
  it('does not retry permanent inference errors', async () => {
    chat.mockRejectedValue(Object.assign(new Error('model missing'), { status: 404 }));
    expect((await executeWorkflow(spec())).status).toBe('failed');
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('stops downstream phases on iteration exhaustion', async () => {
    chat.mockResolvedValue(calls('read'));
    const downstream = vi.fn();
    const result = await executeWorkflow(spec({ stages: [...spec().stages, { name: 'publish', direct: downstream }] }));
    expect(result.status).toBe('budget_exhausted');
    expect(downstream).not.toHaveBeenCalled();
  });
  it('denial blocks later actions in the same batch and is never retried', async () => {
    chat.mockResolvedValueOnce(calls('write', 'read')).mockResolvedValueOnce(text('cancelled'));
    const result = await executeWorkflow(spec({ stages: [{ ...spec().stages[0], options: { onToolCall: async () => false } }] }));
    expect(result).toMatchObject({ status: 'blocked', reason: 'approval_denied' });
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(chat.mock.calls[1][0].tools).toBeUndefined();
  });
  it('requires evidence even if the model claims success', async () => {
    chat.mockResolvedValue(text('Report saved!'));
    const result = await executeWorkflow(spec({ acceptance: [{ type: 'file', path: path.join(dir, 'missing.txt') }] }));
    expect(result).toMatchObject({ status: 'failed', verified: false, reason: 'verification_failed' });
  });
  it('verifies new artifacts and records evidence', async () => {
    const file = path.join(dir, 'report.json');
    write.mockImplementation(async () => { fs.writeFileSync(file, '{"stories":["source"]}'); return 'saved'; });
    chat.mockResolvedValueOnce(calls('write')).mockResolvedValueOnce(text('done'));
    const result = await executeWorkflow(spec({ acceptance: [{ type: 'file', path: file, contains: ['source'], jsonKeys: ['stories'] }] }));
    expect(result).toMatchObject({ status: 'completed', verified: true });
    expect(result.evidence[0]).toMatchObject({ path: file, passed: true });
  });
  it('does not accept a stale artifact from an earlier run', async () => {
    const file = path.join(dir, 'old.txt'); fs.writeFileSync(file, 'old report');
    chat.mockResolvedValue(text('done'));
    expect((await executeWorkflow(spec({ acceptance: [{ type: 'file', path: file }] }))).status).toBe('failed');
  });
  it('does not turn a known tool error into success based on prose', async () => {
    write.mockResolvedValue('Failed to write file: disk full');
    chat.mockResolvedValueOnce(calls('write')).mockResolvedValueOnce(text('done'));
    expect((await executeWorkflow(spec()))).toMatchObject({ status: 'failed', reason: 'tool_error' });
  });
  it('resumes between two calls in one batch without repeating the first', async () => {
    chat.mockResolvedValueOnce(calls('write', 'read')).mockResolvedValueOnce(text('done'));
    let checkpoint;
    await expect(runAgent('task', 'test', { structured: true, onToolCall: async () => true,
      onCheckpoint: value => {
        checkpoint = structuredClone(value);
        if (value.nextCall === 1) throw new Error('simulated process exit');
      },
    })).rejects.toThrow('simulated process exit');
    expect(write).toHaveBeenCalledTimes(1);
    const result = await runAgent('task', 'test', { structured: true, checkpoint });
    expect(result.status).toBe('completed');
    expect(write).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  });
  it('blocks resuming an action with an unknown outcome', async () => {
    chat.mockResolvedValueOnce(calls('write'));
    let checkpoint;
    await expect(runAgent('task', 'test', { onToolCall: async () => true, onCheckpoint: value => {
      checkpoint = structuredClone(value);
      if (value.pendingTool) throw new Error('simulated exit');
    } })).rejects.toThrow();
    const result = await runAgent('task', 'test', { checkpoint, structured: true });
    expect(result).toMatchObject({ status: 'blocked', reason: 'uncertain_tool_outcome' });
    expect(write).not.toHaveBeenCalled();
  });
  it('resumes after a completed stage from a disk checkpoint', async () => {
    const first = vi.fn();
    writeRun('job', { version: 1, signature: fingerprint(spec().definition), status: 'running',
      stage: 1, results: [{ status: 'completed', result: 'saved research' }], checkpoint: null, attempts: 0, baseline: {} });
    chat.mockResolvedValue(text('composed'));
    const result = await executeWorkflow(spec({ stages: [{ name: 'gather', direct: first },
      { ...spec().stages[0], task: previous => `Compose using ${previous}` }] }));
    expect(result.status).toBe('completed'); expect(first).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][0].messages).toContainEqual({ role: 'user', content: 'Compose using saved research' });
  });
  it('refuses concurrent owners and returns a cached completed run', async () => {
    const release = acquireRun('job');
    expect((await executeWorkflow(spec())).reason).toBe('run_locked');
    release(); chat.mockResolvedValue(text('done'));
    await executeWorkflow(spec()); await executeWorkflow(spec());
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('starts a fresh scheduled occurrence after completion', async () => {
    chat.mockResolvedValue(text('done'));
    await executeWorkflow(spec()); await executeWorkflow(spec({ restartCompleted: true }));
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('blocks changed definitions instead of replaying previous actions', async () => {
    chat.mockResolvedValue(text('done')); await executeWorkflow(spec());
    const result = await executeWorkflow(spec({ definition: { task: 'different' } }));
    expect(result.reason).toBe('definition_changed');
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid acceptance criteria before any tool executes', async () => {
    const direct = vi.fn();
    expect((await executeWorkflow(spec({ stages: [{ direct }], acceptance: [{ type: 'shell' }] }))).status).toBe('failed');
    expect(direct).not.toHaveBeenCalled();
  });
  it('fails closed on corrupt run files', async () => {
    fs.mkdirSync(config.RUNS_PATH);
    fs.writeFileSync(path.join(config.RUNS_PATH, `${fingerprint('job')}.json`), '{bad');
    expect((await executeWorkflow(spec())).status).toBe('failed');
    expect(chat).not.toHaveBeenCalled();
  });
  it('recovers a lock left by a dead process', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    const lock = path.join(config.RUNS_PATH, `${fingerprint('job')}.json.lock`);
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: Number(child.stdout), token: 'dead-owner' }));
    const release = acquireRun('job');
    expect(release).toBeTypeOf('function');
    expect(acquireRun('job')).toBeNull();
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });
  it('requires an explicit new run after a blocked outcome', async () => {
    chat.mockResolvedValueOnce(calls('write')).mockResolvedValueOnce(text('cancelled'));
    const blocked = spec({ stages: [{ ...spec().stages[0], options: { onToolCall: async () => false } }] });
    expect((await executeWorkflow(blocked)).status).toBe('blocked');
    expect((await executeWorkflow({ ...blocked, restartCompleted: true })).status).toBe('blocked');
    chat.mockResolvedValueOnce(text('done'));
    expect((await executeWorkflow({ ...blocked, startNew: true })).status).toBe('completed');
  });
  it('checks JSON keys, required text, size, and explicit unchanged permission', async () => {
    const file = path.join(dir, 'data.json'); fs.writeFileSync(file, '{"title":"hello"}');
    const checks = [{ type: 'file', path: file, allowUnchanged: true, minBytes: 5, contains: ['hello'], jsonKeys: ['title'] }];
    const baseline = await snapshotArtifacts(checks);
    expect((await verifyArtifacts(checks, baseline)).verified).toBe(true);
    expect((await verifyArtifacts([{ ...checks[0], jsonKeys: ['missing'] }], baseline)).verified).toBe(false);
    expect((await verifyArtifacts([{ ...checks[0], minBytes: 500 }], baseline)).verified).toBe(false);
  });
});
