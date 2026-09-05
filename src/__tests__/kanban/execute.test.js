import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const config = vi.hoisted(() => ({}));
const workflow = vi.hoisted(() => vi.fn());
vi.mock('../../config.js', () => ({ default: config }));
vi.mock('../../execution/workflow.js', () => ({ executeWorkflow: workflow }));
// Set path before importing the store, which captures KANBAN_PATH at load time.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goose-kanban-'));
config.KANBAN_PATH = path.join(dir, 'kanban.json');
config.RUNS_PATH = path.join(dir, 'runs');
const { createTask, updateTask, getTask } = await import('../../kanban/store.js');
const { executeKanbanTask } = await import('../../kanban/execute.js');
const { startKanbanWatcher } = await import('../../kanban/watcher.js');
let watcher;
beforeEach(() => {
  vi.resetAllMocks();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.KANBAN_PATH, '{"tasks":[]}');
  workflow.mockResolvedValue({ status: 'completed', result: 'done', verified: true, evidence: [] });
});
afterEach(() => { watcher?.stop(); watcher = null; fs.rmSync(dir, { recursive: true, force: true }); });
const callbacks = vi.fn(() => ({ onToolCall: async () => true }));
function ready() { const t = createTask({ title: 'report' }); return updateTask(t.id, { status: 'ready' }); }

describe('Kanban execution', () => {
  it.each(['failed', 'blocked', 'budget_exhausted'])('keeps %s work out of Done', async status => {
    const task = ready(); workflow.mockResolvedValue({ status, result: 'unfinished', verified: false });
    await executeKanbanTask(task.id, callbacks);
    expect(getTask(task.id)).toMatchObject({ status: 'blocked', completedAt: null, outcome: { status } });
  });
  it('stores verification evidence and uses the title when description is empty', async () => {
    const task = ready(); await executeKanbanTask(task.id, callbacks);
    expect(getTask(task.id)).toMatchObject({ status: 'done', outcome: { verified: true } });
    expect(workflow.mock.calls[0][0].stages[0].task).toBe('report');
  });
  it('prevents overlapping manual and background executions', async () => {
    let resolve;
    workflow.mockImplementation(() => new Promise(r => { resolve = r; }));
    const task = ready();
    const first = executeKanbanTask(task.id, callbacks);
    await executeKanbanTask(task.id, callbacks);
    expect(workflow).toHaveBeenCalledTimes(1);
    resolve({ status: 'completed', result: 'done' }); await first;
  });
  it('recovers an in-progress task using its existing run ID', async () => {
    const task = ready(); updateTask(task.id, { status: 'in-progress', runId: 'existing-run' });
    await executeKanbanTask(task.id, callbacks);
    expect(workflow.mock.calls[0][0].id).toBe('existing-run');
    expect(getTask(task.id).status).toBe('done');
  });
  it('moves legacy interrupted tasks aside instead of replaying unknown actions', async () => {
    const task = ready(); updateTask(task.id, { status: 'in-progress' });
    watcher = startKanbanWatcher({ makeAgentCallbacks: callbacks, onUpdate: () => {} });
    await watcher.triggerNow();
    expect(getTask(task.id)).toMatchObject({ status: 'blocked', outcome: { reason: 'missing_checkpoint' } });
    expect(workflow).not.toHaveBeenCalled();
    const next = ready(); await watcher.triggerNow();
    expect(getTask(next.id).status).toBe('done');
  });
});
