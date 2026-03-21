import { describe, it, expect, vi } from 'vitest';
import { tools, toolMap, getToolDefinitions, buildHelpBlocks } from '../../tools/index.js';

describe('tools array', () => {
  it('exports a non-empty array of tools', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('every tool has required fields: name, description, riskLevel, parameters, execute', () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(['safe', 'moderate', 'dangerous']).toContain(tool.riskLevel);
      expect(typeof tool.parameters).toBe('object');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('contains the expected core tools', () => {
    const names = tools.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('fetch_url');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('run_command');
    expect(names).toContain('get_datetime');
    expect(names).toContain('get_system_info');
  });
});

describe('toolMap', () => {
  it('allows O(1) lookup by name', () => {
    expect(toolMap['web_search']).toBeDefined();
    expect(toolMap['run_command']).toBeDefined();
  });

  it('returns undefined for unknown tool names', () => {
    expect(toolMap['nonexistent_tool']).toBeUndefined();
  });

  it('has the same number of entries as the tools array', () => {
    expect(Object.keys(toolMap).length).toBe(tools.length);
  });
});

describe('getToolDefinitions', () => {
  it('returns an array with one entry per tool', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(tools.length);
  });

  it('each definition has type "function" and a function object', () => {
    for (const def of getToolDefinitions()) {
      expect(def.type).toBe('function');
      expect(typeof def.function).toBe('object');
      expect(typeof def.function.name).toBe('string');
      expect(typeof def.function.description).toBe('string');
      expect(typeof def.function.parameters).toBe('object');
    }
  });

  it('tool names in definitions match the tools array', () => {
    const defNames = getToolDefinitions().map(d => d.function.name);
    const toolNames = tools.map(t => t.name);
    expect(defNames).toEqual(toolNames);
  });
});

describe('buildHelpBlocks', () => {
  it('returns an array of Slack Block Kit blocks', () => {
    const blocks = buildHelpBlocks();
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('starts with a header block', () => {
    const blocks = buildHelpBlocks();
    expect(blocks[0].type).toBe('header');
  });

  it('contains a section block for each tool', () => {
    const blocks = buildHelpBlocks();
    const sections = blocks.filter(b => b.type === 'section');
    expect(sections.length).toBe(tools.length);
  });

  it('section blocks contain the tool name', () => {
    const blocks = buildHelpBlocks();
    const sections = blocks.filter(b => b.type === 'section');
    for (const tool of tools) {
      const match = sections.find(s => s.text?.text?.includes(tool.name));
      expect(match).toBeDefined();
    }
  });

  it('ends with a context block', () => {
    const blocks = buildHelpBlocks();
    expect(blocks[blocks.length - 1].type).toBe('context');
  });
});

// ---------------------------------------------------------------------------
// initTools — plugin integration
// Uses vi.resetModules() + vi.doMock() + dynamic import so each test gets
// a fresh module instance unaffected by other tests' plugin state.
// ---------------------------------------------------------------------------
// initTools — plugin integration
// Uses vi.resetModules() + vi.doMock() + dynamic import so each test gets
// a fresh module instance unaffected by other tests' plugin state.
// Access tools/toolMap via the module namespace object (mod.tools) rather
// than destructuring, so live ESM export bindings are read correctly after
// initTools() reassigns the module-level variables.
describe('initTools', () => {
  it('merges plugin tools with built-ins after initTools()', async () => {
    vi.resetModules();
    const pluginTool = {
      name: 'plugin_test_tool',
      description: 'Plugin test',
      riskLevel: 'safe',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    };
    vi.doMock('../../plugins/index.js', () => ({
      loadPlugins: vi.fn().mockResolvedValue([pluginTool]),
    }));
    const mod = await import('../../tools/index.js');
    await mod.initTools();
    const names = mod.tools.map(t => t.name); // live namespace accessor
    expect(names).toContain('plugin_test_tool');
    expect(names).toContain('web_search'); // built-ins still present
  });

  it('built-ins are present before initTools() is called', async () => {
    vi.resetModules();
    vi.doMock('../../plugins/index.js', () => ({
      loadPlugins: vi.fn().mockResolvedValue([]),
    }));
    const mod = await import('../../tools/index.js');
    const names = mod.tools.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('run_command');
  });

  it('toolMap is updated after initTools()', async () => {
    vi.resetModules();
    const pluginTool = {
      name: 'map_test_tool',
      description: 'map test',
      riskLevel: 'safe',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    };
    vi.doMock('../../plugins/index.js', () => ({
      loadPlugins: vi.fn().mockResolvedValue([pluginTool]),
    }));
    const mod = await import('../../tools/index.js');
    await mod.initTools();
    expect(mod.toolMap['map_test_tool']).toBeDefined(); // live namespace accessor
    expect(mod.toolMap['web_search']).toBeDefined();
  });
});
