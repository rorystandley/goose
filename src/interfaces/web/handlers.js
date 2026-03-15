import { runAgent } from '../../agent/loop.js';
import { getHistory, clearHistory, getContextIds } from '../../agent/memory.js';
import { resolveApproval } from '../../agent/approvals.js';
import { createLogger } from '../../logger.js';
import { readFile } from 'node:fs/promises';
import config from '../../config.js';
import { addClient, removeClient, write as sseWrite, broadcast } from './sse.js';
import { makeCallbacks } from './callbacks.js';
import { getHtml } from './public.js';
import { getTasks, getTask, createTask, updateTask, deleteTask } from '../../kanban/store.js';

const log = createLogger('web');
const html = getHtml(config.AGENT_NAME, config.OLLAMA_MODEL, config.KANBAN_POLL_INTERVAL);
const staticAssets = new Map([
  ['/favicon.ico', new URL('../../../docs/assets/favicon.ico', import.meta.url)],
  ['/assets/goose.png', new URL('../../../docs/assets/goose.png', import.meta.url)],
  ['/assets/favicon-16x16.png', new URL('../../../docs/assets/favicon-16x16.png', import.meta.url)],
  ['/assets/favicon-32x32.png', new URL('../../../docs/assets/favicon-32x32.png', import.meta.url)],
  ['/assets/apple-touch-icon.png', new URL('../../../docs/assets/apple-touch-icon.png', import.meta.url)],
  ['/assets/android-chrome-192x192.png', new URL('../../../docs/assets/android-chrome-192x192.png', import.meta.url)],
  ['/assets/android-chrome-512x512.png', new URL('../../../docs/assets/android-chrome-512x512.png', import.meta.url)],
  ['/assets/site.webmanifest', new URL('../../../docs/assets/site.webmanifest', import.meta.url)],
]);

const contentTypes = new Map([
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json'],
]);

function getContentType(path) {
  if (path.endsWith('.webmanifest')) return contentTypes.get('.webmanifest');
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return contentTypes.get(path.slice(dot)) || 'application/octet-stream';
}

/**
 * Parse the request body as JSON. Returns null on failure.
 */
async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * Send a JSON response.
 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Main request handler — routes all HTTP requests for the web UI.
 */
export async function handleRequest(req, res) {
  const url    = new URL(req.url, 'http://localhost');
  const path   = url.pathname;
  const method = req.method;

  // ── CORS / preflight (local-only, permissive) ──────────────────
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  // ── GET static assets (favicon + icons + manifest) ───────────
  if (method === 'GET' && staticAssets.has(path)) {
    try {
      const body = await readFile(staticAssets.get(path));
      res.writeHead(200, {
        'Content-Type': getContentType(path),
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(body);
    } catch (err) {
      log.error('Failed to serve static asset', { path, error: err.message });
      json(res, 404, { error: 'Asset not found' });
    }
    return;
  }

  // ── GET / — serve the dashboard ────────────────────────────────
  if (method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── GET /api/events — SSE stream ───────────────────────────────
  if (method === 'GET' && path === '/api/events') {
    const contextId = url.searchParams.get('contextId');
    if (!contextId) { json(res, 400, { error: 'contextId required' }); return; }

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n');   // initial comment keeps connection alive

    const writeFn = chunk => res.write(chunk);
    addClient(contextId, writeFn);
    req.on('close', () => removeClient(writeFn));
    return;
  }

  // ── POST /api/chat — run the agent ─────────────────────────────
  if (method === 'POST' && path === '/api/chat') {
    const body = await readBody(req);
    if (!body?.task || !body?.contextId) { json(res, 400, { error: 'task and contextId required' }); return; }

    const { task, contextId } = body;
    log.info('Chat request', { contextId, task: task.slice(0, 80) });

    // Fire-and-forget — result flows back via SSE
    runAgent(task, contextId, makeCallbacks(contextId))
      .then(content => {
        sseWrite(contextId, 'agentResponse', { content });
      })
      .catch(err => {
        log.error('Agent error', { contextId, error: err.message });
        sseWrite(contextId, 'agentError', { message: err.message });
      });

    json(res, 202, { contextId });
    return;
  }

  // ── POST /api/approve — approve a dangerous tool ────────────────
  if (method === 'POST' && path === '/api/approve') {
    const body = await readBody(req);
    if (!body?.approvalId) { json(res, 400, { error: 'approvalId required' }); return; }

    resolveApproval(body.approvalId, true);
    if (body.contextId) {
      sseWrite(body.contextId, 'approvalResolved', { approvalId: body.approvalId, approved: true });
    }
    json(res, 200, {});
    return;
  }

  // ── POST /api/deny — deny a dangerous tool ──────────────────────
  if (method === 'POST' && path === '/api/deny') {
    const body = await readBody(req);
    if (!body?.approvalId) { json(res, 400, { error: 'approvalId required' }); return; }

    resolveApproval(body.approvalId, false);
    if (body.contextId) {
      sseWrite(body.contextId, 'approvalResolved', { approvalId: body.approvalId, approved: false });
    }
    json(res, 200, {});
    return;
  }

  // ── GET /api/memory — get conversation history ──────────────────
  if (method === 'GET' && path === '/api/memory') {
    const contextId = url.searchParams.get('contextId');
    if (!contextId) { json(res, 400, { error: 'contextId required' }); return; }

    json(res, 200, { contextId, messages: getHistory(contextId) });
    return;
  }

  // ── DELETE /api/memory — clear conversation history ─────────────
  if (method === 'DELETE' && path === '/api/memory') {
    const contextId = url.searchParams.get('contextId');
    if (!contextId) { json(res, 400, { error: 'contextId required' }); return; }

    clearHistory(contextId);
    json(res, 200, {});
    return;
  }

  // ── GET /api/contexts — list all context IDs ────────────────────
  if (method === 'GET' && path === '/api/contexts') {
    json(res, 200, { contextIds: getContextIds() });
    return;
  }

  // ── Kanban routes ────────────────────────────────────────────────
  // Parse /api/kanban/:id and /api/kanban/:id/trigger
  const kanbanIdMatch = path.match(/^\/api\/kanban\/([^/]+?)(?:\/(trigger))?$/);
  const kanbanId     = kanbanIdMatch?.[1];
  const kanbanAction = kanbanIdMatch?.[2];

  // GET /api/kanban — list all tasks
  if (method === 'GET' && path === '/api/kanban') {
    json(res, 200, { tasks: getTasks() });
    return;
  }

  // POST /api/kanban — create task
  if (method === 'POST' && path === '/api/kanban') {
    const body = await readBody(req);
    if (!body?.title) { json(res, 400, { error: 'title required' }); return; }
    const task = createTask(body);
    broadcast('kanbanUpdate', { tasks: getTasks() });
    json(res, 201, { task });
    return;
  }

  // PUT /api/kanban/:id — update task (status change, edit)
  if (method === 'PUT' && kanbanId && !kanbanAction) {
    const body = await readBody(req);
    if (!body) { json(res, 400, { error: 'body required' }); return; }
    const task = updateTask(kanbanId, body);
    if (!task) { json(res, 404, { error: 'task not found' }); return; }
    broadcast('kanbanUpdate', { tasks: getTasks() });
    json(res, 200, { task });
    return;
  }

  // DELETE /api/kanban/:id — delete task
  if (method === 'DELETE' && kanbanId && !kanbanAction) {
    const ok = deleteTask(kanbanId);
    if (!ok) { json(res, 404, { error: 'task not found' }); return; }
    broadcast('kanbanUpdate', { tasks: getTasks() });
    json(res, 200, {});
    return;
  }

  // POST /api/kanban/:id/trigger — manually fire agent on a ready task
  if (method === 'POST' && kanbanId && kanbanAction === 'trigger') {
    const task = getTask(kanbanId);
    if (!task) { json(res, 404, { error: 'task not found' }); return; }
    if (task.status !== 'ready') { json(res, 409, { error: 'task must be in ready status' }); return; }

    const contextId = `kanban-${task.id}`;
    updateTask(task.id, { status: 'in-progress', startedAt: new Date().toISOString(), contextId });
    broadcast('kanbanUpdate', { tasks: getTasks() });

    runAgent(task.description, contextId, makeCallbacks(contextId))
      .then(result => {
        updateTask(task.id, { status: 'done', completedAt: new Date().toISOString(), result });
        broadcast('kanbanUpdate', { tasks: getTasks() });
      })
      .catch(err => {
        log.error('Triggered kanban task failed', { id: task.id, error: err.message });
        updateTask(task.id, { status: 'ready', startedAt: null, contextId: null });
        broadcast('kanbanUpdate', { tasks: getTasks() });
      });

    json(res, 202, { contextId });
    return;
  }

  // ── 404 ─────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}
