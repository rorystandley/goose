import { runAgent } from '../agent/loop.js';
import { createLogger } from '../logger.js';
import { getReadyTasks, getInProgressTasks, updateTask } from './store.js';

const log = createLogger('kanban:watcher');

/**
 * Start the kanban background watcher.
 *
 * Polls for "ready" tasks on `interval` ms. Runs one task at a time (serial).
 * When a task completes the board is updated via the `onUpdate` callback.
 *
 * @param {object} opts
 * @param {(contextId: string) => object} opts.makeAgentCallbacks - factory returning runAgent callbacks
 * @param {() => void}                    opts.onUpdate           - called after any task state change
 * @param {number}                        opts.interval           - poll interval in ms (default 60 000)
 * @returns {{ pause, resume, triggerNow, getNextCheckAt, stop }}
 */
export function startKanbanWatcher({ makeAgentCallbacks, onUpdate, interval = 60_000 }) {
  let paused  = false;
  let running = false;  // in-memory lock prevents concurrent watcher runs
  let nextCheckAt = Date.now() + interval;
  let timer = null;

  async function checkForWork() {
    if (paused || running) return;

    if (getInProgressTasks().length > 0) {
      log.debug('Task already in progress — skipping poll');
      return;
    }

    const ready = getReadyTasks();
    if (ready.length === 0) return;

    const task = ready[0];
    const contextId = `kanban-${task.id}`;

    running = true;
    log.info('Picking up kanban task', { id: task.id, title: task.title, priority: task.priority, allowDangerous: task.allowDangerous ?? false });

    updateTask(task.id, { status: 'in-progress', startedAt: new Date().toISOString(), contextId });
    onUpdate();

    try {
      const result = await runAgent(task.description, contextId, makeAgentCallbacks(contextId, task));
      updateTask(task.id, { status: 'done', completedAt: new Date().toISOString(), result });
      log.info('Kanban task completed', { id: task.id });
    } catch (err) {
      log.error('Kanban task failed — requeueing', { id: task.id, error: err.message });
      updateTask(task.id, { status: 'ready', startedAt: null, contextId: null });
    } finally {
      running = false;
    }

    onUpdate();
  }

  function schedule() {
    nextCheckAt = Date.now() + interval;
    timer = setTimeout(async () => {
      await checkForWork().catch(err => log.error('Watcher error', { error: err.message }));
      schedule();
    }, interval);
  }

  schedule();
  // Fire immediately on startup (non-blocking)
  checkForWork().catch(err => log.error('Initial kanban check failed', { error: err.message }));

  return {
    pause()        { paused = true; log.info('Kanban watcher paused'); },
    resume()       { paused = false; checkForWork().catch(() => {}); log.info('Kanban watcher resumed'); },
    triggerNow()   { return checkForWork(); },
    getNextCheckAt() { return nextCheckAt; },
    stop()         { if (timer) { clearTimeout(timer); timer = null; } },
  };
}
