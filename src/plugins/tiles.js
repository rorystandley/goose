import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('plugins:tiles');

const MIN_REFRESH_SECONDS = 15;
const MAX_REFRESH_SECONDS = 3600;
const DEFAULT_REFRESH_SECONDS = 60;

function clampRefresh(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REFRESH_SECONDS;
  return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(n)));
}

function projectTileMeta(raw, packageName, source) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) {
    return null;
  }
  if (typeof raw.load !== 'function') return null;
  const id = raw.id.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    log.warn('tile id must be kebab-case — skipped', { packageName, id });
    return null;
  }
  return {
    id,
    key: `${packageName}/${id}`,
    packageName,
    source,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    refreshSeconds: clampRefresh(raw.refreshSeconds ?? raw.refreshInterval ?? DEFAULT_REFRESH_SECONDS),
  };
}

function projectTiles(rawTiles, packageName, source) {
  if (!Array.isArray(rawTiles)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawTiles) {
    const meta = projectTileMeta(raw, packageName, source);
    if (!meta) continue;
    if (seen.has(meta.id)) {
      log.warn('duplicate tile id within plugin — skipped', { packageName, id: meta.id });
      continue;
    }
    seen.add(meta.id);
    out.push(meta);
  }
  return out;
}

async function discoverPluginModules({ importFn }) {
  const plugins = [];
  const nodeModulesDir = path.join(process.cwd(), 'node_modules');

  if (fs.existsSync(nodeModulesDir)) {
    for (const scopeName of ['@goose-tools', '@goose-plugins']) {
      const scopeDir = path.join(nodeModulesDir, scopeName);
      if (!fs.existsSync(scopeDir)) continue;
      const entries = fs.readdirSync(scopeDir, { withFileTypes: true });
      for (const entry of entries.filter(e => e.isDirectory() || e.isSymbolicLink())) {
        const packageName = `${scopeName}/${entry.name}`;
        try {
          const mod = await importFn(packageName);
          plugins.push({ source: 'npm', packageName, mod });
        } catch (err) {
          log.warn('npm plugin tile discovery failed', { package: packageName, error: err.message });
        }
      }
    }

    const nmEntries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
    for (const entry of nmEntries.filter(e => e.isDirectory() && e.name.startsWith('goose-plugin-'))) {
      try {
        const mod = await importFn(entry.name);
        plugins.push({ source: 'npm', packageName: entry.name, mod });
      } catch (err) {
        log.warn('npm plugin tile discovery failed', { package: entry.name, error: err.message });
      }
    }
  }

  const pluginsDir = config.PLUGINS_DIR;
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const dir of entries.filter(e => e.isDirectory())) {
      const entryPath = path.join(pluginsDir, dir.name, 'index.js');
      if (!fs.existsSync(entryPath)) continue;
      try {
        const mod = await importFn(entryPath);
        plugins.push({ source: 'local', packageName: dir.name, mod });
      } catch (err) {
        log.warn('local plugin tile discovery failed', { plugin: dir.name, error: err.message });
      }
    }
  }

  return plugins;
}

/**
 * List command-centre tiles exported by installed plugins.
 * Does not call tile.load() — metadata only.
 *
 * @param {{ importFn?: Function }} options
 * @returns {Promise<Array>}
 */
export async function listPluginTiles({ importFn = async (p) => import(p) } = {}) {
  const plugins = await discoverPluginModules({ importFn });
  const tiles = [];
  const seenKeys = new Set();

  for (const { source, packageName, mod } of plugins) {
    const rawTiles = mod.tiles ?? mod.default?.tiles ?? [];
    for (const meta of projectTiles(rawTiles, packageName, source)) {
      if (seenKeys.has(meta.key)) {
        log.warn('duplicate tile key — skipped', { key: meta.key });
        continue;
      }
      seenKeys.add(meta.key);
      tiles.push(meta);
    }
  }

  return tiles;
}

/**
 * Load live data for one plugin tile by package name + tile id.
 *
 * @param {string} packageName
 * @param {string} tileId
 * @param {{ importFn?: Function }} options
 * @returns {Promise<{ meta: object, data: object }>}
 */
export async function loadPluginTile(packageName, tileId, { importFn = async (p) => import(p) } = {}) {
  if (typeof packageName !== 'string' || !packageName.trim()) {
    throw Object.assign(new Error('packageName is required'), { status: 400 });
  }
  if (typeof tileId !== 'string' || !tileId.trim()) {
    throw Object.assign(new Error('tileId is required'), { status: 400 });
  }

  const plugins = await discoverPluginModules({ importFn });
  const match = plugins.find(p => p.packageName === packageName);
  if (!match) {
    throw Object.assign(new Error(`plugin not found: ${packageName}`), { status: 404 });
  }

  const rawTiles = match.mod.tiles ?? match.mod.default?.tiles ?? [];
  const raw = Array.isArray(rawTiles)
    ? rawTiles.find(t => t && typeof t.id === 'string' && t.id.trim() === tileId.trim())
    : null;
  const meta = projectTileMeta(raw, match.packageName, match.source);
  if (!meta || !raw) {
    throw Object.assign(new Error(`tile not found: ${packageName}/${tileId}`), { status: 404 });
  }

  let data;
  try {
    data = await raw.load();
  } catch (err) {
    log.error('tile load failed', { key: meta.key, error: err.message });
    data = {
      kind: 'error',
      message: err.message || 'Tile failed to load.',
      updatedAt: new Date().toISOString(),
    };
  }

  if (!data || typeof data !== 'object') {
    data = {
      kind: 'error',
      message: 'Tile load() must return an object.',
      updatedAt: new Date().toISOString(),
    };
  }

  return { meta, data };
}

/** Project tile summaries for inclusion in plugin metadata responses. */
export function projectTileSummaries(rawTiles) {
  if (!Array.isArray(rawTiles)) return [];
  return rawTiles
    .map(t => {
      if (!t || typeof t.id !== 'string' || typeof t.load !== 'function') return null;
      return {
        id: t.id.trim(),
        title: typeof t.title === 'string' ? t.title : t.id,
        description: typeof t.description === 'string' ? t.description : '',
        refreshSeconds: clampRefresh(t.refreshSeconds ?? t.refreshInterval ?? DEFAULT_REFRESH_SECONDS),
      };
    })
    .filter(Boolean);
}
