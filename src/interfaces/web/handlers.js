import { executeKanbanTask } from '../../kanban/execute.js';
import { validateCriteria } from '../../execution/verify.js';
import { runAgent } from '../../agent/loop.js';
import { getHistory, clearHistory, getContextIds } from '../../agent/memory.js';
import { resolveApproval } from '../../agent/approvals.js';
import { createLogger } from '../../logger.js';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../../config.js';
import { addClient, removeClient, write as sseWrite, broadcast } from './sse.js';
import { makeCallbacks, makeKanbanCallbacks } from './callbacks.js';
import { getHtml } from './public.js';
import { getTasks, getTask, createTask, updateTask, deleteTask } from '../../kanban/store.js';
import { getAudio, getAudioById, deleteAudio } from '../../audio/store.js';
import { loadMissions, executeMission } from '../../scheduler/index.js';
import { getAllMissionStates } from '../../scheduler/state.js';
import { loadMonitors, getMonitorStates } from '../../monitors/index.js';
import { loadPluginMetadata } from '../../plugins/metadata.js';
import { CronExpressionParser } from 'cron-parser';

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
  ['/app.css', new URL('./dist/app.css', import.meta.url)],
  ['/app.js', new URL('./dist/app.js', import.meta.url)],
]);

const contentTypes = new Map([
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
]);

const audioContentTypes = new Map([
  ['wav', 'audio/wav'],
  ['flac', 'audio/flac'],
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['ogg', 'audio/ogg'],
]);

// Resolve AUDIO_OUTPUT_DIRS once at module load — these become the canonical
// allowlist for streaming/deleting audio files. We resolve symlinks so a later
// realpath check on a file path is meaningful.
const audioAllowedRoots = (config.AUDIO_OUTPUT_DIRS ?? [])
  .map(p => {
    try { return fs.realpathSync(p); } catch { return null; }
  })
  .filter(Boolean);

/**
 * Validate that `filePath` resolves to a real file inside one of the configured
 * AUDIO_OUTPUT_DIRS roots. Returns the resolved absolute path on success, or
 * null if the path is outside every root, is a symlink escaping the roots, or
 * does not exist.
 */
function resolveAudioPath(filePath) {
  if (!filePath || audioAllowedRoots.length === 0) return null;
  let real;
  try {
    real = fs.realpathSync(filePath);
  } catch {
    return null;
  }
  for (const root of audioAllowedRoots) {
    const rel = path.relative(root, real);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return real;
    if (rel === '') return real;
  }
  return null;
}

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
        'Cache-Control': 'no-cache',
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
    try { validateCriteria(body.acceptance); }
    catch (err) { json(res, 400, { error: err.message }); return; }
    const task = createTask(body);
    broadcast('kanbanUpdate', { tasks: getTasks() });
    json(res, 201, { task });
    return;
  }

  // PUT /api/kanban/:id — update task (status change, edit)
  if (method === 'PUT' && kanbanId && !kanbanAction) {
    const body = await readBody(req);
    if (!body) { json(res, 400, { error: 'body required' }); return; }
    const existing = getTask(kanbanId);
    if (existing?.status === 'in-progress') { json(res, 409, { error: 'Cannot edit a running task' }); return; }
    try { validateCriteria(body.acceptance); }
    catch (err) { json(res, 400, { error: err.message }); return; }
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) =>
      ['title', 'description', 'priority', 'tags', 'allowDangerous', 'acceptance', 'status'].includes(key)));
    if (patch.status && !['backlog', 'ready'].includes(patch.status)) {
      json(res, 400, { error: 'Tasks can only be moved to backlog or ready manually' }); return;
    }
    // Reopening is an explicit new run. Preserve old checkpoints for inspection.
    if (patch.status === 'backlog') Object.assign(patch, { runId: null, outcome: null, result: null, startedAt: null, completedAt: null, contextId: null });
    const task = updateTask(kanbanId, patch);
    if (!task) { json(res, 404, { error: 'task not found' }); return; }
    broadcast('kanbanUpdate', { tasks: getTasks() });
    json(res, 200, { task });
    return;
  }

  // DELETE /api/kanban/:id — delete task
  if (method === 'DELETE' && kanbanId && !kanbanAction) {
    if (getTask(kanbanId)?.status === 'in-progress') { json(res, 409, { error: 'Cannot delete a running task' }); return; }
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
    void executeKanbanTask(task.id, makeKanbanCallbacks,
      () => broadcast('kanbanUpdate', { tasks: getTasks() }));

    json(res, 202, { contextId });
    return;
  }

  // ── Audio routes ────────────────────────────────────────────────
  const audioStreamMatch = path.match(/^\/api\/audio\/([^/]+)\/stream$/);
  const audioIdMatch     = path.match(/^\/api\/audio\/([^/]+)$/);

  // GET /api/audio — list all manifest entries (newest first), flag missing files
  if (method === 'GET' && path === '/api/audio') {
    const entries = getAudio()
      .slice()
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .map(entry => ({
        ...entry,
        missing: !entry.path || !fs.existsSync(entry.path),
        playable: !!resolveAudioPath(entry.path),
      }));
    json(res, 200, { audio: entries });
    return;
  }

  // GET /api/audio/:id/stream — stream audio file (security validated)
  if (method === 'GET' && audioStreamMatch) {
    const id = audioStreamMatch[1];
    const entry = getAudioById(id);
    if (!entry) { json(res, 404, { error: 'audio not found' }); return; }

    const realPath = resolveAudioPath(entry.path);
    if (!realPath) {
      json(res, 403, { error: 'audio path is outside AUDIO_OUTPUT_DIRS or missing' });
      return;
    }

    try {
      const stat = await fsp.stat(realPath);
      const contentType = audioContentTypes.get((entry.format ?? 'wav').toLowerCase()) ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'none',
        'Cache-Control': 'private, max-age=0',
      });
      fs.createReadStream(realPath).pipe(res);
    } catch (err) {
      log.warn('Audio stream failed', { id, error: err.message });
      json(res, 404, { error: 'audio file missing' });
    }
    return;
  }

  // DELETE /api/audio/:id — remove manifest entry + unlink file (tolerant)
  if (method === 'DELETE' && audioIdMatch) {
    const id = audioIdMatch[1];
    const entry = getAudioById(id);
    if (!entry) { json(res, 404, { error: 'audio not found' }); return; }

    const realPath = resolveAudioPath(entry.path);
    if (realPath) {
      try { await fsp.unlink(realPath); }
      catch (err) {
        if (err.code !== 'ENOENT') log.warn('Audio unlink failed', { id, error: err.message });
      }
    } else {
      log.debug('Skipping unlink — audio path outside AUDIO_OUTPUT_DIRS', { id });
    }

    await deleteAudio(id);
    broadcast('audioDeleted', { id });
    json(res, 200, {});
    return;
  }

  // ── Mission routes ──────────────────────────────────────────────
  const missionTriggerMatch = path.match(/^\/api\/missions\/([^/]+)\/trigger$/);

  // GET /api/missions — list with state + nextRun
  if (method === 'GET' && path === '/api/missions') {
    const missions = loadMissions();
    const states = new Map(getAllMissionStates(missions.map(m => m.name)).map(s => [s.name, s]));
    const enriched = missions.map(m => {
      let nextRun = null;
      try {
        const it = CronExpressionParser.parse(m.cron, {
          tz: m.timezone ?? 'UTC',
          currentDate: new Date(),
        });
        nextRun = it.next().toDate().toISOString();
      } catch {
        nextRun = null;
      }
      const state = states.get(m.name) ?? { status: 'idle' };
      return {
        name: m.name,
        cron: m.cron,
        timezone: m.timezone ?? 'UTC',
        enabled: m.enabled !== false,
        contextId: m.contextId ?? `mission-${m.name}`,
        speakResponse: !!m.speakResponse,
        speakOnFailure: !!m.speakOnFailure,
        slackChannel: m.slackChannel ?? null,
        hasPhases: Array.isArray(m.phases),
        isDirect: !!m.direct,
        nextRun,
        status: state.status,
        lastRun: state.lastRun ?? null,
        lastError: state.lastError ?? null,
        lastDuration: state.lastDuration ?? null,
        verified: state.outcome?.verified ?? false,
      };
    });
    json(res, 200, { missions: enriched });
    return;
  }

  // POST /api/missions/:name/trigger — invoke executeMission manually
  if (method === 'POST' && missionTriggerMatch) {
    const name = decodeURIComponent(missionTriggerMatch[1]);
    const missions = loadMissions();
    const mission = missions.find(m => m.name === name);
    if (!mission) { json(res, 404, { error: 'mission not found' }); return; }

    const body = await readBody(req);
    log.info('Manual mission trigger', { name });
    // Fire-and-forget — state updates flow via SSE
    executeMission(mission, { source: 'manual', ...(body?.startNew === true ? { startNew: true } : {}) }).catch(err => {
      log.error('Manual mission trigger crashed', { name, error: err.message });
    });
    json(res, 202, { name, status: 'triggered' });
    return;
  }

  // ── Monitor routes ──────────────────────────────────────────────
  if (method === 'GET' && path === '/api/monitors') {
    json(res, 200, { monitors: getMonitorStates() });
    return;
  }

  // ── Plugin routes ───────────────────────────────────────────────
  if (method === 'GET' && path === '/api/plugins') {
    try {
      const plugins = await loadPluginMetadata();
      json(res, 200, { plugins });
    } catch (err) {
      log.error('Failed to load plugin metadata', { error: err.message });
      json(res, 500, { error: 'failed to load plugins' });
    }
    return;
  }

  // ── System info ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/system') {
    json(res, 200, {
      agentName: config.AGENT_NAME,
      model: config.OLLAMA_MODEL,
      fastModel: config.FAST_MODEL || null,
      smartModel: config.SMART_MODEL || null,
      routingModel: config.ROUTING_MODEL || null,
      llmBackend: config.LLM_BACKEND,
      ollamaHost: config.OLLAMA_HOST,
      ttsBackend: config.VOICE_TTS_BACKEND ?? 'say',
      ttsModel: config.VOICE_MLX_TTS_MODEL ?? null,
      ttsVoice: config.VOICE_MLX_TTS_VOICE ?? null,
      audioOutputDirsConfigured: audioAllowedRoots.length > 0,
      uptime: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    });
    return;
  }

  // ── 404 ─────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}
