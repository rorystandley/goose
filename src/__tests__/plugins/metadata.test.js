import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Build a temp directory layout so loadPluginMetadata has real package.json files to read.
const tmpRoot = path.join(os.tmpdir(), `goose-plugin-meta-${process.pid}`);
const localPluginsDir = path.join(tmpRoot, 'plugins');
const fakeNodeModules = path.join(tmpRoot, 'node_modules');

function setupLocalPlugin(name, pkgJson, indexBody) {
  const dir = path.join(localPluginsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkgJson) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), indexBody);
  return path.join(dir, 'index.js');
}

vi.mock('../../config.js', () => ({
  default: { PLUGINS_DIR: localPluginsDir },
}));

const { loadPluginMetadata } = await import('../../plugins/metadata.js');

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(localPluginsDir, { recursive: true });
  // Need empty node_modules so npm scan branch doesn't fail.
  fs.mkdirSync(fakeNodeModules, { recursive: true });
});

describe('plugins/metadata loadPluginMetadata', () => {
  it('returns empty array when no plugins are installed', async () => {
    const result = await loadPluginMetadata();
    // npm scan walks process.cwd()/node_modules which may have @goose-plugins/*, so
    // we only assert on the local subset (no local plugins here, none from this fixture).
    const local = result.filter(p => p.source === 'local' && p.path.startsWith(localPluginsDir));
    expect(local).toEqual([]);
  });

  it('returns metadata for a local plugin with valid tools', async () => {
    setupLocalPlugin('hello', { name: 'hello', version: '1.2.3', description: 'Greets people' },
      'export const tools = [{ name: "say_hi", description: "Say hi", riskLevel: "safe", parameters: {}, execute: async () => "hi" }];');

    const result = await loadPluginMetadata({
      importFn: async (p) => import(p),
    });
    const hello = result.find(p => p.packageName === 'hello' && p.source === 'local');
    expect(hello).toBeDefined();
    expect(hello.version).toBe('1.2.3');
    expect(hello.description).toBe('Greets people');
    expect(hello.tools).toEqual([
      { name: 'say_hi', description: 'Say hi', riskLevel: 'safe' },
    ]);
  });

  it('returns null version when local plugin has no package.json', async () => {
    setupLocalPlugin('bare', null,
      'export const tools = [{ name: "bare_tool", description: "x", riskLevel: "safe", parameters: {}, execute: async () => "y" }];');

    const result = await loadPluginMetadata({
      importFn: async (p) => import(p),
    });
    const bare = result.find(p => p.packageName === 'bare' && p.source === 'local');
    expect(bare).toBeDefined();
    expect(bare.version).toBeNull();
    expect(bare.tools[0].name).toBe('bare_tool');
  });

  it('captures loadError when plugin throws on import', async () => {
    setupLocalPlugin('broken', { name: 'broken', version: '0.1.0' },
      'throw new Error("import-time boom");');

    const result = await loadPluginMetadata({
      importFn: async (p) => import(p),
    });
    const broken = result.find(p => p.packageName === 'broken' && p.source === 'local');
    expect(broken).toBeDefined();
    expect(broken.loadError).toMatch(/boom/);
    expect(broken.tools).toEqual([]);
  });

  it('defaults riskLevel to safe when tool omits it', async () => {
    setupLocalPlugin('riskless', { name: 'riskless', version: '0.0.1' },
      'export const tools = [{ name: "t", description: "", parameters: {}, execute: async () => "" }];');
    const result = await loadPluginMetadata({
      importFn: async (p) => import(p),
    });
    const t = result.find(p => p.packageName === 'riskless' && p.source === 'local');
    expect(t.tools[0].riskLevel).toBe('safe');
  });
});
