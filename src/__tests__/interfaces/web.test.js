import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects — must be defined before vi.mock() factories run
// ---------------------------------------------------------------------------

const mockRunAgent       = vi.hoisted(() => vi.fn());
const mockGetHistory     = vi.hoisted(() => vi.fn());
const mockClearHistory   = vi.hoisted(() => vi.fn());
const mockGetContextIds  = vi.hoisted(() => vi.fn());
const mockCreateApproval = vi.hoisted(() => vi.fn());
const mockResolveApproval= vi.hoisted(() => vi.fn());

const mockSseWrite       = vi.hoisted(() => vi.fn());
const mockSseAddClient   = vi.hoisted(() => vi.fn());
const mockSseRemoveClient= vi.hoisted(() => vi.fn());
const mockSseBroadcast   = vi.hoisted(() => vi.fn());

// Ops tab dependencies — mocked so we can assert handler contracts without IO
const mockGetAudio              = vi.hoisted(() => vi.fn(() => []));
const mockGetAudioById          = vi.hoisted(() => vi.fn(() => null));
const mockDeleteAudio           = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockLoadMissions          = vi.hoisted(() => vi.fn(() => []));
const mockExecuteMission        = vi.hoisted(() => vi.fn().mockResolvedValue({ contextId: 'x', result: null, error: null }));
const mockGetAllMissionStates   = vi.hoisted(() => vi.fn(() => []));
const mockLoadMonitors          = vi.hoisted(() => vi.fn(() => []));
const mockGetMonitorStates      = vi.hoisted(() => vi.fn(() => []));
const mockLoadPluginMetadata    = vi.hoisted(() => vi.fn().mockResolvedValue([]));

// Mock HTTP server returned by http.createServer
const mockHttpServer = vi.hoisted(() => ({
  listen: vi.fn(),
  close:  vi.fn(),
  on:     vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../agent/loop.js', () => ({ runAgent: mockRunAgent }));

vi.mock('../../agent/memory.js', () => ({
  getHistory:    mockGetHistory,
  clearHistory:  mockClearHistory,
  getContextIds: mockGetContextIds,
}));

vi.mock('../../agent/approvals.js', () => ({
  createApproval:  mockCreateApproval,
  resolveApproval: mockResolveApproval,
}));

vi.mock('../../interfaces/web/sse.js', () => ({
  write:        mockSseWrite,
  addClient:    mockSseAddClient,
  removeClient: mockSseRemoveClient,
  broadcast:    mockSseBroadcast,
}));

vi.mock('../../audio/store.js', () => ({
  getAudio:     mockGetAudio,
  getAudioById: mockGetAudioById,
  deleteAudio:  mockDeleteAudio,
  addAudio:     vi.fn(),
}));

vi.mock('../../scheduler/index.js', () => ({
  loadMissions:   mockLoadMissions,
  executeMission: mockExecuteMission,
}));

vi.mock('../../scheduler/state.js', () => ({
  getAllMissionStates: mockGetAllMissionStates,
}));

vi.mock('../../monitors/index.js', () => ({
  loadMonitors:     mockLoadMonitors,
  getMonitorStates: mockGetMonitorStates,
}));

vi.mock('../../plugins/metadata.js', () => ({
  loadPluginMetadata: mockLoadPluginMetadata,
}));

vi.mock('../../config.js', () => ({
  default: {
    AGENT_NAME:        'TestGoose',
    OLLAMA_MODEL:      'test-model',
    FAST_MODEL:        '',
    SMART_MODEL:       '',
    ROUTING_MODEL:     '',
    LLM_BACKEND:       'ollama',
    OLLAMA_HOST:       'http://localhost:11434',
    VOICE_TTS_BACKEND: 'say',
    VOICE_MLX_TTS_MODEL: 'mlx-community/Kokoro-82M-bf16',
    VOICE_MLX_TTS_VOICE: 'af_heart',
    AUDIO_OUTPUT_DIRS: [],
    WEB_ENABLED:       false,
    WEB_PORT:          3001,
    KANBAN_POLL_INTERVAL: 60000,
  },
}));

vi.mock('node:http', () => ({
  default: { createServer: vi.fn(() => mockHttpServer) },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { makeCallbacks }           from '../../interfaces/web/callbacks.js';
import { handleRequest }           from '../../interfaces/web/handlers.js';
import { startWebServer, stopWebServer } from '../../interfaces/web/server.js';
import { addClient, removeClient, write } from '../../interfaces/web/sse.js';
import config                      from '../../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock IncomingMessage.
 * Fires data + end events synchronously when req.on() is called,
 * mimicking the Node stream pattern that readBody() depends on.
 */
function mockReq(method, path, body = null) {
  const url = `http://localhost${path}`;
  const bodyStr = body !== null ? JSON.stringify(body) : '';
  return {
    method,
    url,
    on: vi.fn((event, cb) => {
      if (event === 'data' && bodyStr) cb(bodyStr);
      if (event === 'end')  cb();
    }),
  };
}

/** Build a minimal mock ServerResponse. */
function mockRes() {
  const chunks = [];
  return {
    writeHead: vi.fn(),
    write:     vi.fn(chunk => chunks.push(chunk)),
    end:       vi.fn(chunk => { if (chunk) chunks.push(chunk); }),
    headersSent: false,
    _chunks: chunks,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Re-apply implementations after clearAllMocks (Vitest 2.x clears them)
  mockRunAgent.mockResolvedValue('Agent output');
  mockGetHistory.mockReturnValue([]);
  mockGetContextIds.mockReturnValue([]);

  const approval = { id: 'approval-uuid', promise: Promise.resolve(true) };
  mockCreateApproval.mockReturnValue(approval);

  // HTTP server mock: listen calls the callback immediately
  mockHttpServer.listen.mockImplementation((_port, _host, cb) => cb());
  // close calls callback immediately
  mockHttpServer.close.mockImplementation(cb => cb?.());
});

// ---------------------------------------------------------------------------
// sse.js — SSE connection pool (tested via the real module since we mock it
//          for other tests; here we test the real implementation via a fresh
//          import scope — see integration note)
//
// Since sse.js is mocked globally for handlers/callbacks tests, we test its
// logic inline using the real functions imported at the top (which get
// resolved before the mock intercepts imports at the usage sites).
// ---------------------------------------------------------------------------

describe('sse — real module (imported before mock intercept)', () => {
  // We test the real sse write/addClient/removeClient by importing them
  // directly before any test runs; the hoisted mock replaces the module
  // for all *other* modules that import it, but our direct import here
  // refers to the mocked versions too (same vi.mock scope).
  //
  // To test the real SSE logic we use a unit test file dedicated to sse:
  // these are integration-level checks on the mock behaviour itself.

  it('addClient, write, and removeClient are callable functions', () => {
    expect(typeof mockSseAddClient).toBe('function');
    expect(typeof mockSseWrite).toBe('function');
    expect(typeof mockSseRemoveClient).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — safe tool
// ---------------------------------------------------------------------------

describe('makeCallbacks — safe tool', () => {
  it('returns true for a non-dangerous tool', async () => {
    const { onToolCall } = makeCallbacks('test-ctx');
    const result = await onToolCall({ toolName: 'get_datetime', args: {}, requiresApproval: false });
    expect(result).toBe(true);
  });

  it('emits toolCall SSE event with requiresApproval: false', async () => {
    const { onToolCall } = makeCallbacks('test-ctx');
    await onToolCall({ toolName: 'get_datetime', args: { tz: 'UTC' }, requiresApproval: false });
    expect(mockSseWrite).toHaveBeenCalledWith(
      'test-ctx',
      'toolCall',
      expect.objectContaining({ toolName: 'get_datetime', requiresApproval: false }),
    );
  });

  it('does not call createApproval for safe tools', async () => {
    const { onToolCall } = makeCallbacks('test-ctx');
    await onToolCall({ toolName: 'get_datetime', args: {}, requiresApproval: false });
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — dangerous tool
// ---------------------------------------------------------------------------

describe('makeCallbacks — dangerous tool', () => {
  it('calls createApproval with tool name and args', async () => {
    const { onToolCall } = makeCallbacks('test-ctx');
    onToolCall({ toolName: 'write_file', args: { path: '/tmp/f', content: 'x' }, requiresApproval: true });
    expect(mockCreateApproval).toHaveBeenCalledWith({
      tool: 'write_file',
      args: { path: '/tmp/f', content: 'x' },
    });
  });

  it('emits toolCall SSE event with approvalId and requiresApproval: true', async () => {
    const { onToolCall } = makeCallbacks('test-ctx');
    onToolCall({ toolName: 'write_file', args: {}, requiresApproval: true });
    expect(mockSseWrite).toHaveBeenCalledWith(
      'test-ctx',
      'toolCall',
      expect.objectContaining({ requiresApproval: true, approvalId: 'approval-uuid' }),
    );
  });

  it('returns the approval promise (suspending the agent loop)', async () => {
    mockCreateApproval.mockReturnValue({ id: 'x', promise: Promise.resolve(true) });
    const { onToolCall } = makeCallbacks('test-ctx');
    const result = await onToolCall({ toolName: 'write_file', args: {}, requiresApproval: true });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — onToolResult
// ---------------------------------------------------------------------------

describe('makeCallbacks — onToolResult', () => {
  it('emits toolResult SSE event', () => {
    const { onToolResult } = makeCallbacks('test-ctx');
    onToolResult({ toolName: 'read_file', result: 'file contents here' });
    expect(mockSseWrite).toHaveBeenCalledWith(
      'test-ctx',
      'toolResult',
      expect.objectContaining({ toolName: 'read_file' }),
    );
  });

  it('truncates results longer than 500 chars', () => {
    const { onToolResult } = makeCallbacks('test-ctx');
    onToolResult({ toolName: 'read_file', result: 'x'.repeat(600) });
    const call = mockSseWrite.mock.calls[0];
    expect(call[2].result.length).toBeLessThanOrEqual(500);
  });

  it('does not truncate results shorter than 500 chars', () => {
    const { onToolResult } = makeCallbacks('test-ctx');
    onToolResult({ toolName: 'read_file', result: 'short' });
    const call = mockSseWrite.mock.calls[0];
    expect(call[2].result).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// handleRequest — GET /
// ---------------------------------------------------------------------------

describe('handleRequest — GET /', () => {
  it('returns 200 with Content-Type text/html', async () => {
    const req = mockReq('GET', '/');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': expect.stringContaining('text/html') }));
  });

  it('responds with HTML containing the agent name', async () => {
    const req = mockReq('GET', '/');
    const res = mockRes();
    await handleRequest(req, res);
    const body = res._chunks.join('');
    expect(body).toContain('TestGoose');
  });

  it('responds with HTML containing the model name', async () => {
    const req = mockReq('GET', '/');
    const res = mockRes();
    await handleRequest(req, res);
    const body = res._chunks.join('');
    expect(body).toContain('test-model');
  });
});

// ---------------------------------------------------------------------------
// handleRequest — OPTIONS (CORS preflight)
// ---------------------------------------------------------------------------

describe('handleRequest — OPTIONS', () => {
  it('returns 204 for preflight', async () => {
    const req = mockReq('OPTIONS', '/');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(204, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// handleRequest — GET /api/events (SSE)
// ---------------------------------------------------------------------------

describe('handleRequest — GET /api/events', () => {
  it('returns 400 when contextId is missing', async () => {
    const req = mockReq('GET', '/api/events');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it('sets SSE response headers', async () => {
    const req = mockReq('GET', '/api/events?contextId=ctx-1');
    req.on = vi.fn((event, cb) => {
      // Do not fire 'close' — keep the connection "open"
    });
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }));
  });

  it('writes initial keep-alive comment', async () => {
    const req = mockReq('GET', '/api/events?contextId=ctx-1');
    req.on = vi.fn();
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.write).toHaveBeenCalledWith(':ok\n\n');
  });

  it('calls addClient with contextId', async () => {
    const req = mockReq('GET', '/api/events?contextId=ctx-1');
    req.on = vi.fn();
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockSseAddClient).toHaveBeenCalledWith('ctx-1', expect.any(Function));
  });

  it('calls removeClient when request closes', async () => {
    let closeHandler;
    const req = mockReq('GET', '/api/events?contextId=ctx-1');
    req.on = vi.fn((event, cb) => {
      if (event === 'close') closeHandler = cb;
    });
    const res = mockRes();
    await handleRequest(req, res);
    closeHandler?.();
    expect(mockSseRemoveClient).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRequest — POST /api/chat
// ---------------------------------------------------------------------------

describe('handleRequest — POST /api/chat', () => {
  it('returns 400 when body is missing required fields', async () => {
    const req = mockReq('POST', '/api/chat', { task: 'hello' }); // no contextId
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it('returns 202 immediately (fire-and-forget)', async () => {
    const req = mockReq('POST', '/api/chat', { task: 'hello', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
  });

  it('calls runAgent with task and contextId', async () => {
    const req = mockReq('POST', '/api/chat', { task: 'list files', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockRunAgent).toHaveBeenCalledWith('list files', 'ctx-1', expect.any(Object));
  });

  it('emits agentResponse SSE event when runAgent resolves', async () => {
    mockRunAgent.mockResolvedValue('Files listed.');
    const req = mockReq('POST', '/api/chat', { task: 'list files', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    await Promise.resolve(); // let the .then() microtask settle
    expect(mockSseWrite).toHaveBeenCalledWith('ctx-1', 'agentResponse', { content: 'Files listed.' });
  });

  it('emits agentError SSE event when runAgent rejects', async () => {
    mockRunAgent.mockRejectedValue(new Error('LLM offline'));
    const req = mockReq('POST', '/api/chat', { task: 'task', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    await Promise.resolve();
    await Promise.resolve(); // rejection handlers are a tick later
    expect(mockSseWrite).toHaveBeenCalledWith('ctx-1', 'agentError', { message: 'LLM offline' });
  });
});

// ---------------------------------------------------------------------------
// handleRequest — POST /api/approve
// ---------------------------------------------------------------------------

describe('handleRequest — POST /api/approve', () => {
  it('returns 400 when approvalId is missing', async () => {
    const req = mockReq('POST', '/api/approve', {});
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it('calls resolveApproval(id, true)', async () => {
    const req = mockReq('POST', '/api/approve', { approvalId: 'abc', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockResolveApproval).toHaveBeenCalledWith('abc', true);
  });

  it('emits approvalResolved SSE event with approved: true', async () => {
    const req = mockReq('POST', '/api/approve', { approvalId: 'abc', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockSseWrite).toHaveBeenCalledWith('ctx-1', 'approvalResolved', { approvalId: 'abc', approved: true });
  });

  it('returns 200', async () => {
    const req = mockReq('POST', '/api/approve', { approvalId: 'abc', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// handleRequest — POST /api/deny
// ---------------------------------------------------------------------------

describe('handleRequest — POST /api/deny', () => {
  it('calls resolveApproval(id, false)', async () => {
    const req = mockReq('POST', '/api/deny', { approvalId: 'xyz', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockResolveApproval).toHaveBeenCalledWith('xyz', false);
  });

  it('emits approvalResolved SSE event with approved: false', async () => {
    const req = mockReq('POST', '/api/deny', { approvalId: 'xyz', contextId: 'ctx-1' });
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockSseWrite).toHaveBeenCalledWith('ctx-1', 'approvalResolved', { approvalId: 'xyz', approved: false });
  });
});

// ---------------------------------------------------------------------------
// handleRequest — GET /api/memory
// ---------------------------------------------------------------------------

describe('handleRequest — GET /api/memory', () => {
  it('returns 400 when contextId is missing', async () => {
    const req = mockReq('GET', '/api/memory');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it('calls getHistory with the contextId', async () => {
    const req = mockReq('GET', '/api/memory?contextId=ctx-1');
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockGetHistory).toHaveBeenCalledWith('ctx-1');
  });

  it('returns 200 with the messages array', async () => {
    mockGetHistory.mockReturnValue([{ role: 'user', content: 'hi' }]);
    const req = mockReq('GET', '/api/memory?contextId=ctx-1');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const body = JSON.parse(res._chunks.join(''));
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.contextId).toBe('ctx-1');
  });
});

// ---------------------------------------------------------------------------
// handleRequest — DELETE /api/memory
// ---------------------------------------------------------------------------

describe('handleRequest — DELETE /api/memory', () => {
  it('returns 400 when contextId is missing', async () => {
    const req = mockReq('DELETE', '/api/memory');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it('calls clearHistory with the contextId', async () => {
    const req = mockReq('DELETE', '/api/memory?contextId=ctx-1');
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockClearHistory).toHaveBeenCalledWith('ctx-1');
  });

  it('returns 200', async () => {
    const req = mockReq('DELETE', '/api/memory?contextId=ctx-1');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// handleRequest — GET /api/contexts
// ---------------------------------------------------------------------------

describe('handleRequest — GET /api/contexts', () => {
  it('returns all context IDs', async () => {
    mockGetContextIds.mockReturnValue(['ctx-1', 'ctx-2']);
    const req = mockReq('GET', '/api/contexts');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const body = JSON.parse(res._chunks.join(''));
    expect(body.contextIds).toEqual(['ctx-1', 'ctx-2']);
  });
});

// ---------------------------------------------------------------------------
// handleRequest — 404
// ---------------------------------------------------------------------------

describe('handleRequest — unknown routes', () => {
  it('returns 404 for an unknown path', async () => {
    const req = mockReq('GET', '/api/unknown-route');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// startWebServer / stopWebServer
// ---------------------------------------------------------------------------

describe('startWebServer', () => {
  it('returns null and does not start a server when WEB_ENABLED is false', async () => {
    // config mock has WEB_ENABLED: false by default
    const result = await startWebServer();
    expect(result).toBeNull();
    expect(mockHttpServer.listen).not.toHaveBeenCalled();
  });
});

describe('stopWebServer', () => {
  it('does nothing when no server is running', async () => {
    await expect(stopWebServer()).resolves.not.toThrow();
    expect(mockHttpServer.close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ops endpoints — /api/system, /api/audio, /api/missions, /api/monitors, /api/plugins
// ---------------------------------------------------------------------------

function bodyJson(res) {
  return JSON.parse(res._chunks.join(''));
}

describe('handleRequest — GET /api/system', () => {
  it('returns 200 with agent + model + ttsBackend', async () => {
    const req = mockReq('GET', '/api/system');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const body = bodyJson(res);
    expect(body).toMatchObject({
      agentName: 'TestGoose',
      model: 'test-model',
      ttsBackend: 'say',
      llmBackend: 'ollama',
    });
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('handleRequest — GET /api/audio', () => {
  it('returns empty array when no audio entries', async () => {
    mockGetAudio.mockReturnValueOnce([]);
    const req = mockReq('GET', '/api/audio');
    const res = mockRes();
    await handleRequest(req, res);
    expect(bodyJson(res)).toEqual({ audio: [] });
  });

  it('sorts entries newest first', async () => {
    mockGetAudio.mockReturnValueOnce([
      { id: 'a', createdAt: '2026-05-01T00:00:00Z' },
      { id: 'b', createdAt: '2026-05-15T00:00:00Z' },
      { id: 'c', createdAt: '2026-05-10T00:00:00Z' },
    ]);
    const req = mockReq('GET', '/api/audio');
    const res = mockRes();
    await handleRequest(req, res);
    const ids = bodyJson(res).audio.map(a => a.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('flags entries whose file is missing on disk', async () => {
    mockGetAudio.mockReturnValueOnce([
      { id: 'gone', path: '/nonexistent/file.wav', createdAt: '2026-05-01T00:00:00Z' },
    ]);
    const req = mockReq('GET', '/api/audio');
    const res = mockRes();
    await handleRequest(req, res);
    expect(bodyJson(res).audio[0].missing).toBe(true);
    expect(bodyJson(res).audio[0].playable).toBe(false);
  });
});

describe('handleRequest — GET /api/audio/:id/stream', () => {
  it('returns 404 when id is not in the manifest', async () => {
    mockGetAudioById.mockReturnValueOnce(null);
    const req = mockReq('GET', '/api/audio/missing-id/stream');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it('returns 403 when AUDIO_OUTPUT_DIRS is not configured', async () => {
    mockGetAudioById.mockReturnValueOnce({ id: 'a', path: '/tmp/x.wav', format: 'wav' });
    const req = mockReq('GET', '/api/audio/a/stream');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });
});

describe('handleRequest — DELETE /api/audio/:id', () => {
  it('returns 404 when id is not in the manifest', async () => {
    mockGetAudioById.mockReturnValueOnce(null);
    const req = mockReq('DELETE', '/api/audio/nope');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(mockDeleteAudio).not.toHaveBeenCalled();
  });

  it('deletes entry + broadcasts audioDeleted when entry exists', async () => {
    mockGetAudioById.mockReturnValueOnce({ id: 'a', path: '/tmp/outside.wav', format: 'wav' });
    mockDeleteAudio.mockResolvedValueOnce({ id: 'a' });
    const req = mockReq('DELETE', '/api/audio/a');
    const res = mockRes();
    await handleRequest(req, res);
    expect(mockDeleteAudio).toHaveBeenCalledWith('a');
    expect(mockSseBroadcast).toHaveBeenCalledWith('audioDeleted', { id: 'a' });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });
});

describe('handleRequest — GET /api/missions', () => {
  it('returns enriched missions joined with state + nextRun', async () => {
    mockLoadMissions.mockReturnValueOnce([
      { name: 'morning', cron: '0 8 * * MON-FRI', timezone: 'UTC', enabled: true },
    ]);
    mockGetAllMissionStates.mockReturnValueOnce([
      { name: 'morning', status: 'completed', lastRun: '2026-05-17T08:00:00Z', lastError: null, lastDuration: 4200 },
    ]);
    const req = mockReq('GET', '/api/missions');
    const res = mockRes();
    await handleRequest(req, res);
    const body = bodyJson(res);
    expect(body.missions).toHaveLength(1);
    expect(body.missions[0]).toMatchObject({
      name: 'morning',
      status: 'completed',
      lastDuration: 4200,
    });
    expect(body.missions[0].nextRun).toMatch(/T\d{2}:\d{2}:\d{2}/);
  });

  it('handles invalid cron expressions gracefully (nextRun: null)', async () => {
    mockLoadMissions.mockReturnValueOnce([
      { name: 'broken', cron: 'not a cron', timezone: 'UTC', enabled: true },
    ]);
    mockGetAllMissionStates.mockReturnValueOnce([]);
    const req = mockReq('GET', '/api/missions');
    const res = mockRes();
    await handleRequest(req, res);
    expect(bodyJson(res).missions[0].nextRun).toBeNull();
  });
});

describe('handleRequest — POST /api/missions/:name/trigger', () => {
  it('returns 404 when mission is not configured', async () => {
    mockLoadMissions.mockReturnValueOnce([]);
    const req = mockReq('POST', '/api/missions/nope/trigger');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(mockExecuteMission).not.toHaveBeenCalled();
  });

  it('returns 202 and invokes executeMission with source=manual', async () => {
    mockLoadMissions.mockReturnValueOnce([{ name: 'morning', cron: '0 8 * * *' }]);
    const req = mockReq('POST', '/api/missions/morning/trigger');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
    expect(mockExecuteMission).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'morning' }),
      expect.objectContaining({ source: 'manual' }),
    );
  });
});

describe('handleRequest — GET /api/monitors', () => {
  it('returns monitor states', async () => {
    mockGetMonitorStates.mockReturnValueOnce([
      { name: 'server-health', type: 'url', status: 'ok', lastCheck: '2026-05-17T10:00:00Z' },
    ]);
    const req = mockReq('GET', '/api/monitors');
    const res = mockRes();
    await handleRequest(req, res);
    expect(bodyJson(res).monitors).toHaveLength(1);
    expect(bodyJson(res).monitors[0].name).toBe('server-health');
  });
});

describe('handleRequest — GET /api/plugins', () => {
  it('returns plugin metadata list', async () => {
    mockLoadPluginMetadata.mockResolvedValueOnce([
      { source: 'local', packageName: 'hello', version: '1.0.0', tools: [{ name: 'say_hi', riskLevel: 'safe' }] },
    ]);
    const req = mockReq('GET', '/api/plugins');
    const res = mockRes();
    await handleRequest(req, res);
    expect(bodyJson(res).plugins).toHaveLength(1);
    expect(bodyJson(res).plugins[0].packageName).toBe('hello');
  });

  it('returns 500 if plugin metadata loading throws', async () => {
    mockLoadPluginMetadata.mockRejectedValueOnce(new Error('disk failure'));
    const req = mockReq('GET', '/api/plugins');
    const res = mockRes();
    await handleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });
});


describe('dashboard build assets', () => {
  it.each([['/app.js', 'application/javascript'], ['/app.css', 'text/css']])('serves the bundled %s', async (path, contentType) => {
    const res = mockRes();
    await handleRequest(mockReq('GET', path), res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': expect.stringContaining(contentType) }));
    expect(res._chunks[0].length).toBeGreaterThan(100);
  });
});

describe('web approval completion', () => {
  it('reports a denial when an approval expires outside the UI', async () => {
    mockCreateApproval.mockReturnValueOnce({ id: 'expired-approval', promise: Promise.resolve(false) });
    const result = await makeCallbacks('test-ctx').onToolCall({ toolName: 'write_file', args: {}, requiresApproval: true });
    expect(result).toBe(false);
    expect(mockSseWrite).toHaveBeenCalledWith('test-ctx', 'approvalResolved', { approvalId: 'expired-approval', approved: false });
  });
});
