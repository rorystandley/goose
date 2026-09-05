import http from 'node:http';
import config from '../../config.js';
import { createLogger } from '../../logger.js';
import { handleRequest } from './handlers.js';
import { broadcast } from './sse.js';
import { getTasks } from '../../kanban/store.js';
import { startKanbanWatcher } from '../../kanban/watcher.js';
import { makeKanbanCallbacks } from './callbacks.js';

const log = createLogger('web');

let server = null;
let watcher = null;


/**
 * Start the web UI HTTP server.
 * Returns the http.Server instance, or null if WEB_ENABLED is false.
 */
export async function startWebServer() {
  if (!config.WEB_ENABLED) {
    log.info('Web UI disabled (set WEB_ENABLED=true to activate)');
    return null;
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      log.error('Unhandled request error', { error: err.message });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(config.WEB_PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  log.info(`Web UI ready`, { url: `http://localhost:${config.WEB_PORT}` });

  watcher = startKanbanWatcher({
    makeAgentCallbacks: (contextId, task) => makeKanbanCallbacks(contextId, task),
    onUpdate: () => broadcast('kanbanUpdate', { tasks: getTasks() }),
    interval: config.KANBAN_POLL_INTERVAL,
  });

  return server;
}

/**
 * Gracefully stop the web UI server.
 */
export async function stopWebServer() {
  watcher?.stop();
  watcher = null;
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  log.info('Web UI stopped');
}
