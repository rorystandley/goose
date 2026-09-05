import { executeKanbanTask, isTaskActive } from './execute.js';
import { createLogger } from '../logger.js';
import { getReadyTasks, getInProgressTasks } from './store.js';

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
  let stopped = false;
  let paused  = false;
  let running = false;  // in-memory lock prevents concurrent watcher runs
  let nextCheckAt = Date.now() + interval;
  let timer = null;

  async function checkForWork() {
    if (stopped || paused || running) return;

    // Recover orphaned in-progress work before picking up another queued task.
    const inProgress = getInProgressTasks();
    const task = inProgress.length ? inProgress.find(t => !isTaskActive(t.id)) : getReadyTasks()[0];
    if (!task) return;
    running = true;
    try { await executeKanbanTask(task.id, makeAgentCallbacks, onUpdate); }
    finally { running = false; }
  }

  function schedule() {
    if (stopped) return;
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
    stop()         { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
  };
}
