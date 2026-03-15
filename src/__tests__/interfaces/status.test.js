import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const mockOllamaList   = vi.hoisted(() => vi.fn());
const mockGetContextIds = vi.hoisted(() => vi.fn());
const mockGetHistory    = vi.hoisted(() => vi.fn());
const mockGetFacts      = vi.hoisted(() => vi.fn());
const mockReadFileSync  = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(function () {
    return { list: mockOllamaList };
  }),
}));

vi.mock('../../agent/memory.js', () => ({
  getContextIds: mockGetContextIds,
  getHistory:    mockGetHistory,
}));

vi.mock('../../agent/facts.js', () => ({
  getFacts: mockGetFacts,
}));

vi.mock('../../config.js', () => ({
  default: {
    AGENT_NAME:     'TestGoose',
    OLLAMA_MODEL:   'qwen3:14b',
    OLLAMA_HOST:    'http://localhost:11434',
    MISSIONS_PATH:  '/data/missions.json',
    MONITORS_PATH:  '/data/monitors.json',
    THOUGHTS_PATH:  '/data/thoughts.jsonl',
  },
}));

vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync },
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { buildStatusBlocks } = await import('../../interfaces/slack/status.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MISSIONS = {
  missions: [
    { name: 'morning-briefing', cron: '0 8 * * *', timezone: 'Europe/London', enabled: true },
    { name: 'free-thought',     cron: '0 */4 * * *',                          enabled: false },
  ],
};

const MONITORS = {
  monitors: [
    { name: 'high-cpu', type: 'system', metric: 'cpu', threshold: 85, interval: '2m', enabled: true },
    { name: 'site',     type: 'url',    url: 'https://example.com', interval: '5m', enabled: false },
  ],
};

const THOUGHT = JSON.stringify({
  timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 minutes ago
  thought:   'Something interesting happened during the last run.',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultMocks() {
  mockOllamaList.mockResolvedValue({ models: [{ name: 'qwen3:14b' }, { name: 'qwen2.5:7b' }] });
  mockGetContextIds.mockReturnValue(['user-123', 'mission-morning']);
  mockGetHistory.mockReturnValue([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  mockGetFacts.mockReturnValue({ name: 'Alex', location: 'London' });
  mockReadFileSync.mockImplementation((path) => {
    if (path === '/data/missions.json')  return JSON.stringify(MISSIONS);
    if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
    if (path === '/data/thoughts.jsonl') return THOUGHT;
    throw new Error('File not found');
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildStatusBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('returns a non-empty array of blocks', async () => {
    const blocks = await buildStatusBlocks();
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('includes a header block with agent name', async () => {
    const blocks = await buildStatusBlocks();
    const header = blocks.find(b => b.type === 'header');
    expect(header).toBeDefined();
    expect(header.text.text).toContain('TestGoose');
  });

  // ── Ollama ──────────────────────────────────────────────────────────────

  it('shows Ollama connected when list() succeeds', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('✅');
    expect(text).toContain('Ollama');
    expect(text).toContain('2 models available');
  });

  it('shows singular "model" when only one model is available', async () => {
    mockOllamaList.mockResolvedValue({ models: [{ name: 'qwen3:14b' }] });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('1 model available');
  });

  it('shows Ollama unreachable when list() rejects', async () => {
    mockOllamaList.mockRejectedValue(new Error('connection refused'));
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('❌');
    expect(text).toContain('unreachable');
  });

  // ── Missions ─────────────────────────────────────────────────────────────

  it('shows mission count in header line', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('1 active');
    expect(text).toContain('1 disabled');
  });

  it('renders each mission name and cron', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('morning-briefing');
    expect(text).toContain('0 8 * * *');
    expect(text).toContain('Europe/London');
    expect(text).toContain('free-thought');
  });

  it('marks enabled missions green and disabled ones dark', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('🟢');
    expect(text).toContain('⚫');
  });

  it('shows a placeholder when no missions are configured', async () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  return JSON.stringify({ missions: [] });
      if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
      if (path === '/data/thoughts.jsonl') return THOUGHT;
      throw new Error('not found');
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('No missions configured');
  });

  it('handles missing missions.json gracefully', async () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  throw new Error('ENOENT');
      if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
      if (path === '/data/thoughts.jsonl') return THOUGHT;
      throw new Error('not found');
    });
    const blocks = await buildStatusBlocks();
    expect(Array.isArray(blocks)).toBe(true);
  });

  // ── Monitors ─────────────────────────────────────────────────────────────

  it('renders each monitor name, type, and interval', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('high-cpu');
    expect(text).toContain('system');
    expect(text).toContain('2m');
    expect(text).toContain('site');
    expect(text).toContain('url');
    expect(text).toContain('https://example.com');
  });

  it('shows system monitor threshold as the detail', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('cpu > 85%');
  });

  it('shows a placeholder when no monitors are configured', async () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  return JSON.stringify(MISSIONS);
      if (path === '/data/monitors.json')  return JSON.stringify({ monitors: [] });
      if (path === '/data/thoughts.jsonl') return THOUGHT;
      throw new Error('not found');
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('No monitors configured');
  });

  // ── Memory ────────────────────────────────────────────────────────────────

  it('lists active memory contexts', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('user-123');
    expect(text).toContain('mission-morning');
    expect(text).toContain('2 msgs');
  });

  it('shows context count in the memory header', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('2 contexts');
  });

  it('shows singular "context" when only one context exists', async () => {
    mockGetContextIds.mockReturnValue(['only-one']);
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('1 context');
    expect(text).not.toContain('1 contexts');
  });

  it('shows no-conversations message when memory is empty', async () => {
    mockGetContextIds.mockReturnValue([]);
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('No conversations in memory yet');
  });

  // ── Facts ─────────────────────────────────────────────────────────────────

  it('shows facts section when facts exist', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('Facts');
    expect(text).toContain('name');
    expect(text).toContain('Alex');
    expect(text).toContain('location');
    expect(text).toContain('London');
  });

  it('omits facts section when no facts are stored', async () => {
    mockGetFacts.mockReturnValue({});
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('📌 Facts');
  });

  it('shows overflow message when more than 5 facts exist', async () => {
    mockGetFacts.mockReturnValue({
      a: '1', b: '2', c: '3', d: '4', e: '5', f: '6',
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('and 1 more');
  });

  // ── Latest thought ────────────────────────────────────────────────────────

  it('shows the latest thought preview', async () => {
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('Something interesting happened');
    expect(text).toContain('💭');
  });

  it('shows "just now" for very recent thoughts', async () => {
    const fresh = JSON.stringify({
      timestamp: new Date(Date.now() - 30_000).toISOString(),
      thought: 'Very fresh thought',
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  return JSON.stringify(MISSIONS);
      if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
      if (path === '/data/thoughts.jsonl') return fresh;
      throw new Error('not found');
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('just now');
  });

  it('truncates long thoughts with ellipsis', async () => {
    const longThought = JSON.stringify({
      timestamp: new Date().toISOString(),
      thought: 'x'.repeat(400),
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  return JSON.stringify(MISSIONS);
      if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
      if (path === '/data/thoughts.jsonl') return longThought;
      throw new Error('not found');
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).toContain('…');
  });

  it('omits thought section when thoughts.jsonl is missing', async () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/data/missions.json')  return JSON.stringify(MISSIONS);
      if (path === '/data/monitors.json')  return JSON.stringify(MONITORS);
      throw new Error('ENOENT');
    });
    const blocks = await buildStatusBlocks();
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('💭 Latest thought');
  });
});
