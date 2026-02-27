import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync  = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: { existsSync: mockExistsSync, readdirSync: mockReaddirSync },
}));

vi.mock('../../config.js', () => ({
  default: { PLUGINS_DIR: '/fake/plugins' },
}));

import { loadPlugins } from '../../plugins/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTool = (name) => ({
  name,
  description: `${name} description`,
  riskLevel: 'safe',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: vi.fn(),
});

/** Stub readdirSync to return fake plugin directories */
function fakeDir(...names) {
  return names.map(name => ({ name, isDirectory: () => true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: node_modules paths don't exist → npm discovery skips cleanly.
  // Non-node_modules paths (local plugins dir, index.js files) exist by default.
  // Individual tests override as needed.
  mockExistsSync.mockImplementation((p) => !String(p).includes('node_modules'));
  mockReaddirSync.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// No plugins directory
// ---------------------------------------------------------------------------
describe('loadPlugins — no plugins directory', () => {
  it('returns empty array when plugins dir does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await loadPlugins();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empty plugins directory
// ---------------------------------------------------------------------------
describe('loadPlugins — empty plugins directory', () => {
  it('returns empty array when no subdirectories are present', async () => {
    mockReaddirSync.mockReturnValue([]);
    const result = await loadPlugins();
    expect(result).toEqual([]);
  });

  it('ignores non-directory entries', async () => {
    mockReaddirSync.mockReturnValue([
      { name: 'some-file.js', isDirectory: () => false },
    ]);
    const result = await loadPlugins();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Plugin discovery errors
// ---------------------------------------------------------------------------
describe('loadPlugins — plugin errors', () => {
  it('skips a plugin directory with no index.js (logs warning, returns empty)', async () => {
    // Use path-based implementation: index.js files don't exist, everything else does.
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes('node_modules')) return false;
      if (String(p).includes('index.js')) return false;
      return true;
    });
    mockReaddirSync.mockReturnValue(fakeDir('no-index-plugin'));

    const result = await loadPlugins();
    expect(result).toEqual([]);
  });

  it('skips a plugin whose import throws (logs error, does not crash)', async () => {
    mockReaddirSync.mockReturnValue(fakeDir('broken-plugin'));
    const importFn = vi.fn().mockRejectedValue(new Error('SyntaxError: Unexpected token'));

    const result = await loadPlugins({ importFn });
    expect(result).toEqual([]);
  });

  it('skips a plugin whose tools export is not an array', async () => {
    mockReaddirSync.mockReturnValue(fakeDir('bad-export-plugin'));
    const importFn = vi.fn().mockResolvedValue({ tools: 'not-an-array' });

    const result = await loadPlugins({ importFn });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Successful plugin loading
// ---------------------------------------------------------------------------
describe('loadPlugins — successful loading', () => {
  it('returns tools from a valid plugin', async () => {
    // beforeEach default: node_modules don't exist (npm skips), local paths exist.
    mockReaddirSync.mockReturnValue(fakeDir('valid-plugin'));
    const tool = mockTool('my_tool');
    const importFn = vi.fn().mockResolvedValue({ tools: [tool] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my_tool');
  });

  it('accepts a default export with a tools array', async () => {
    // beforeEach default: node_modules don't exist (npm skips), local paths exist.
    mockReaddirSync.mockReturnValue(fakeDir('default-export-plugin'));
    const tool = mockTool('default_tool');
    const importFn = vi.fn().mockResolvedValue({ default: { tools: [tool] } });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('default_tool');
  });

  it('merges tools from multiple plugins into a flat array', async () => {
    mockReaddirSync.mockReturnValue(fakeDir('plugin-a', 'plugin-b'));
    const toolA = mockTool('tool_a');
    const toolB = mockTool('tool_b');
    const importFn = vi.fn()
      .mockResolvedValueOnce({ tools: [toolA] })
      .mockResolvedValueOnce({ tools: [toolB] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(2);
    expect(result.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
  });

  it('continues loading remaining plugins after one fails', async () => {
    mockReaddirSync.mockReturnValue(fakeDir('broken-plugin', 'good-plugin'));
    const goodTool = mockTool('good_tool');
    const importFn = vi.fn()
      .mockRejectedValueOnce(new Error('Load error'))
      .mockResolvedValueOnce({ tools: [goodTool] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good_tool');
  });

  it('calls importFn with the correct path for each plugin', async () => {
    mockReaddirSync.mockReturnValue(fakeDir('my-plugin'));
    const importFn = vi.fn().mockResolvedValue({ tools: [] });

    await loadPlugins({ importFn });
    expect(importFn).toHaveBeenCalledWith(
      expect.stringContaining('my-plugin/index.js'),
    );
  });
});

// ---------------------------------------------------------------------------
// npm package discovery
// ---------------------------------------------------------------------------
describe('loadPlugins — npm package discovery', () => {
  it('loads @goose-tools/* scoped packages from node_modules', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('node_modules')) return true;
      if (String(p).includes('@goose-tools')) return true;
      return false; // no local plugins dir
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('architecture');
      return []; // no goose-plugin-* in node_modules root
    });
    const tool = mockTool('remember_system');
    const importFn = vi.fn().mockResolvedValue({ tools: [tool] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('remember_system');
    expect(importFn).toHaveBeenCalledWith('@goose-tools/architecture');
  });

  it('loads goose-plugin-* unscoped packages from node_modules', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes('node_modules') && !String(p).includes('@goose-tools')) return true;
      if (String(p).includes('@goose-tools')) return false; // no scope dir
      return false; // no local plugins dir
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('node_modules')) {
        return fakeDir('goose-plugin-hello', 'other-package');
      }
      return [];
    });
    const tool = mockTool('hello_world');
    const importFn = vi.fn().mockResolvedValue({ tools: [tool] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('hello_world');
    expect(importFn).toHaveBeenCalledWith('goose-plugin-hello');
    // 'other-package' doesn't match goose-plugin-* — must not be imported
    expect(importFn).not.toHaveBeenCalledWith('other-package');
  });

  it('skips an npm plugin whose import throws (logs error, does not crash)', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('node_modules')) return true;
      if (String(p).includes('@goose-tools')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('broken');
      return [];
    });
    const importFn = vi.fn().mockRejectedValue(new Error('Module not found'));

    const result = await loadPlugins({ importFn });
    expect(result).toEqual([]);
  });

  it('skips an npm plugin whose tools export is not an array', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('node_modules')) return true;
      if (String(p).includes('@goose-tools')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('bad-export');
      return [];
    });
    const importFn = vi.fn().mockResolvedValue({ tools: 'not-an-array' });

    const result = await loadPlugins({ importFn });
    expect(result).toEqual([]);
  });

  it('deduplicates tools with the same name — npm-sourced tool wins', async () => {
    // npm: loads 'shared_tool' from @goose-tools/pkg-a
    // local: also tries to load 'shared_tool' — should be skipped
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('node_modules')) return true;
      if (String(p).includes('@goose-tools')) return true;
      return true; // local plugins dir and index.js also exist
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('pkg-a');
      if (String(p).includes('node_modules')) return []; // no goose-plugin-*
      return fakeDir('local-duplicate'); // local plugins dir
    });
    const npmTool  = mockTool('shared_tool');
    const localTool = { ...mockTool('shared_tool'), description: 'local version' };
    const importFn = vi.fn()
      .mockResolvedValueOnce({ tools: [npmTool] })    // @goose-tools/pkg-a
      .mockResolvedValueOnce({ tools: [localTool] }); // /fake/plugins/local-duplicate/index.js

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(npmTool); // npm version wins
  });

  it('non-duplicate tools from local dir are kept alongside npm tools', async () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('node_modules')) return true;
      if (String(p).includes('@goose-tools')) return true;
      return true;
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('pkg-a');
      if (String(p).includes('node_modules')) return [];
      return fakeDir('local-unique');
    });
    const npmTool   = mockTool('npm_tool');
    const localTool = mockTool('local_tool');
    const importFn = vi.fn()
      .mockResolvedValueOnce({ tools: [npmTool] })
      .mockResolvedValueOnce({ tools: [localTool] });

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(2);
    expect(result.map(t => t.name)).toEqual(['npm_tool', 'local_tool']);
  });

  it('npm plugins appear before local directory plugins in the result', async () => {
    mockExistsSync.mockImplementation(() => true); // everything exists
    mockReaddirSync.mockImplementation((p) => {
      if (String(p).includes('@goose-tools')) return fakeDir('arch');
      if (String(p).includes('node_modules')) return []; // no goose-plugin-* unscoped
      return fakeDir('local-plugin'); // local plugins dir (/fake/plugins)
    });
    const npmTool = mockTool('npm_tool');
    const localTool = mockTool('local_tool');
    const importFn = vi.fn()
      .mockResolvedValueOnce({ tools: [npmTool] })   // @goose-tools/arch
      .mockResolvedValueOnce({ tools: [localTool] }); // /fake/plugins/local-plugin/index.js

    const result = await loadPlugins({ importFn });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('npm_tool');
    expect(result[1].name).toBe('local_tool');
  });
});
