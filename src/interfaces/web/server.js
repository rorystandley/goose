import http from 'node:http';
import config from '../../config.js';
import { createLogger } from '../../logger.js';
import { handleRequest } from './handlers.js';
import { write as sseWrite, broadcast } from './sse.js';
import { getTasks } from '../../kanban/store.js';
import { startKanbanWatcher } from '../../kanban/watcher.js';
import { createApproval } from '../../agent/approvals.js';
import { toolMap } from '../../tools/index.js';

const log = createLogger('web');

let server = null;

/**
 * Build runAgent callbacks for a kanban task.
 *
 * - allowDangerous:true  → auto-approve all dangerous tools (scheduler pattern)
 * - allowDangerous:false → broadcast dangerous-tool approval requests to ALL
 *                          connected browser clients via the kanbanApproval SSE event
 *
 * @param {string} contextId  — e.g. 'kanban-task-xxx'
 * @param {object} task       — full task object from the store
 */
function makeKanbanCallbacks(contextId, task) {
  if (task.allowDangerous) {
    // Auto-approve — no user interaction required
    return {
      onToolCall: async () => true,
      onToolResult: ({ toolName, result }) => {
        sseWrite(contextId, 'toolResult', { toolName, result: String(result).slice(0, 500) });
      },
    };
  }

  // Default: gate dangerous tools via a broadcast approval request
  return {
    onToolCall: async ({ toolName, args, requiresApproval }) => {
      const riskLevel = toolMap[toolName]?.riskLevel ?? 'safe';
      if (!requiresApproval) {
        // Safe/moderate — stream to the kanban task's contextId (for View Live)
        sseWrite(contextId, 'toolCall', { toolName, args, requiresApproval: false, riskLevel });
        return true;
      }
      // Dangerous — broadcast to every connected browser so the user can see it
      const { id: approvalId, promise } = createApproval({ tool: toolName, args });
      broadcast('kanbanApproval', { taskId: task.id, toolName, args, approvalId, riskLevel });
      return promise;
    },
    onToolResult: ({ toolName, result }) => {
      sseWrite(contextId, 'toolResult', { toolName, result: String(result).slice(0, 500) });
    },
  };
}

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

  startKanbanWatcher({
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
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  log.info('Web UI stopped');
}
