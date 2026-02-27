import { runAgent } from '../../agent/loop.js';
import { getHistory, clearHistory, getContextIds } from '../../agent/memory.js';
import { resolveApproval } from '../../agent/approvals.js';
import { createLogger } from '../../logger.js';
import config from '../../config.js';
import { addClient, removeClient, write as sseWrite } from './sse.js';
import { makeCallbacks } from './callbacks.js';
import { getHtml } from './public.js';

const log = createLogger('web');
const html = getHtml(config.AGENT_NAME, config.OLLAMA_MODEL);

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

  // ── 404 ─────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}
