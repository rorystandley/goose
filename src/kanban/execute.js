import { randomUUID } from 'node:crypto';
import { getTask, updateTask } from './store.js';
import { acquireRun } from '../execution/store.js';
import { executeWorkflow } from '../execution/workflow.js';

const active = new Set();
export function isTaskActive(id) { return active.has(id); }

/** Shared entry point for manual triggers and the background watcher. */
export async function executeKanbanTask(id, makeAgentCallbacks, onUpdate = () => {}) {
  if (active.has(id)) return;
  const release = acquireRun(`kanban-task:${id}`);
  if (!release) return;
  let task;
  try { task = getTask(id); }
  catch (err) { release(); throw err; }
  if (!task || !['ready', 'in-progress'].includes(task.status)) { release(); return; }
  active.add(id);
  const contextId = task.contextId || `kanban-${task.id}`;
  const runId = task.runId || `kanban:${task.id}:${randomUUID()}`;
  try {
    if (task.status === 'in-progress' && !task.runId) {
      updateTask(id, { status: 'blocked', result: 'Interrupted legacy task has no checkpoint. Review previous actions, then reopen.',
        outcome: { status: 'blocked', reason: 'missing_checkpoint', verified: false } });
      return;
    }
    updateTask(id, { status: 'in-progress', runId, contextId,
      startedAt: task.startedAt || new Date().toISOString() });
    onUpdate();
    const outcome = await executeWorkflow({
      id: runId,
      definition: { task: task.description || task.title, acceptance: task.acceptance ?? [], allowDangerous: task.allowDangerous },
      stages: [{ name: 'execute', task: task.description || task.title, contextId,
        options: makeAgentCallbacks(contextId, task) }],
      acceptance: task.acceptance ?? [],
    });
    if (outcome.reason === 'run_locked') return;
    updateTask(id, {
      status: outcome.status === 'completed' ? 'done' : 'blocked',
      completedAt: outcome.status === 'completed' ? new Date().toISOString() : null,
      result: outcome.result, outcome,
    });
  } catch (err) {
    updateTask(id, { status: 'blocked', result: err.message,
      outcome: { status: 'failed', reason: 'execution_error', result: err.message, verified: false } });
  } finally {
    active.delete(id);
    release();
    onUpdate();
  }
}
