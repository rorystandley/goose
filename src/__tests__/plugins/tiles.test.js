import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpRoot = path.join(os.tmpdir(), `goose-tiles-${process.pid}`);
const localPluginsDir = path.join(tmpRoot, 'plugins');

vi.mock('../../config.js', () => ({
  default: { PLUGINS_DIR: localPluginsDir },
}));

const {
  listPluginTiles,
  loadPluginTile,
  projectTileSummaries,
} = await import('../../plugins/tiles.js');

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(localPluginsDir, { recursive: true });
});

function writeLocalPlugin(name, body) {
  const dir = path.join(localPluginsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), body);
  return path.join(dir, 'index.js');
}

describe('projectTileSummaries', () => {
  it('projects valid tiles and skips invalid ones', () => {
    const summaries = projectTileSummaries([
      { id: 'watchlist', title: 'Crypto', description: 'prices', refreshSeconds: 30, load: async () => ({}) },
      { id: 'bad', title: 'No load' },
      null,
    ]);
    expect(summaries).toEqual([
      { id: 'watchlist', title: 'Crypto', description: 'prices', refreshSeconds: 30 },
    ]);
  });
});

describe('listPluginTiles / loadPluginTile', () => {
  it('lists tiles from local plugins', async () => {
    writeLocalPlugin('demo', `
      export const tiles = [{
        id: 'status',
        title: 'Demo',
        description: 'A demo tile',
        refreshSeconds: 45,
        load: async () => ({ kind: 'text', text: 'hello' }),
      }];
      export const tools = [];
    `);

    const tiles = await listPluginTiles({ importFn: async (p) => import(p) });
    const demo = tiles.filter(t => t.packageName === 'demo');
    expect(demo).toHaveLength(1);
    expect(demo[0]).toMatchObject({
      id: 'status',
      key: 'demo/status',
      packageName: 'demo',
      title: 'Demo',
      refreshSeconds: 45,
    });
  });

  it('loads tile data', async () => {
    writeLocalPlugin('markets', `
      export const tiles = [{
        id: 'status',
        title: 'Markets',
        load: async () => ({ kind: 'table', columns: [], rows: [], updatedAt: '2026-01-01T00:00:00.000Z' }),
      }];
      export const tools = [];
    `);

    const result = await loadPluginTile('markets', 'status', { importFn: async (p) => import(p) });
    expect(result.meta.id).toBe('status');
    expect(result.data.kind).toBe('table');
  });

  it('returns 404 for unknown plugin', async () => {
    await expect(loadPluginTile('missing', 'x', { importFn: async (p) => import(p) }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('wraps load() throws as error payloads', async () => {
    writeLocalPlugin('boom', `
      export const tiles = [{
        id: 'fail',
        title: 'Boom',
        load: async () => { throw new Error('nope'); },
      }];
      export const tools = [];
    `);

    const result = await loadPluginTile('boom', 'fail', { importFn: async (p) => import(p) });
    expect(result.data.kind).toBe('error');
    expect(result.data.message).toMatch(/nope/);
  });
});
