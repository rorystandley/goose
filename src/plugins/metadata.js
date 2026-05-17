import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('plugins:metadata');

function readVersion(pluginPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readDescription(pluginPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf8'));
    return pkg.description ?? null;
  } catch {
    return null;
  }
}

function projectTools(rawTools) {
  if (!Array.isArray(rawTools)) return [];
  return rawTools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    riskLevel: t.riskLevel ?? 'safe',
  }));
}

async function loadNpmPluginMetadata(importFn) {
  const results = [];
  const nodeModulesDir = path.join(process.cwd(), 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) return results;

  for (const scopeName of ['@goose-tools', '@goose-plugins']) {
    const scopeDir = path.join(nodeModulesDir, scopeName);
    if (!fs.existsSync(scopeDir)) continue;

    const entries = fs.readdirSync(scopeDir, { withFileTypes: true });
    for (const entry of entries.filter(e => e.isDirectory() || e.isSymbolicLink())) {
      const packageName = `${scopeName}/${entry.name}`;
      const pluginPath = path.join(scopeDir, entry.name);
      try {
        const mod = await importFn(packageName);
        const rawTools = mod.tools ?? mod.default?.tools ?? [];
        results.push({
          source: 'npm',
          packageName,
          version: readVersion(pluginPath),
          description: readDescription(pluginPath),
          path: pluginPath,
          tools: projectTools(rawTools),
        });
      } catch (err) {
        log.warn('npm plugin metadata load failed', { package: packageName, error: err.message });
        results.push({
          source: 'npm',
          packageName,
          version: readVersion(pluginPath),
          description: readDescription(pluginPath),
          path: pluginPath,
          tools: [],
          loadError: err.message,
        });
      }
    }
  }

  // Unscoped goose-plugin-* packages
  const nmEntries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  for (const entry of nmEntries.filter(e => e.isDirectory() && e.name.startsWith('goose-plugin-'))) {
    const packageName = entry.name;
    const pluginPath = path.join(nodeModulesDir, packageName);
    try {
      const mod = await importFn(packageName);
      const rawTools = mod.tools ?? mod.default?.tools ?? [];
      results.push({
        source: 'npm',
        packageName,
        version: readVersion(pluginPath),
        description: readDescription(pluginPath),
        path: pluginPath,
        tools: projectTools(rawTools),
      });
    } catch (err) {
      log.warn('npm plugin metadata load failed', { package: packageName, error: err.message });
      results.push({
        source: 'npm',
        packageName,
        version: readVersion(pluginPath),
        description: readDescription(pluginPath),
        path: pluginPath,
        tools: [],
        loadError: err.message,
      });
    }
  }

  return results;
}

async function loadLocalPluginMetadata(importFn) {
  const results = [];
  const pluginsDir = config.PLUGINS_DIR;
  if (!fs.existsSync(pluginsDir)) return results;

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const dir of entries.filter(e => e.isDirectory())) {
    const entryPath = path.join(pluginsDir, dir.name, 'index.js');
    const pluginPath = path.join(pluginsDir, dir.name);
    if (!fs.existsSync(entryPath)) continue;

    try {
      const mod = await importFn(entryPath);
      const rawTools = mod.tools ?? mod.default?.tools ?? [];
      results.push({
        source: 'local',
        packageName: dir.name,
        version: readVersion(pluginPath),
        description: readDescription(pluginPath),
        path: pluginPath,
        tools: projectTools(rawTools),
      });
    } catch (err) {
      log.warn('local plugin metadata load failed', { plugin: dir.name, error: err.message });
      results.push({
        source: 'local',
        packageName: dir.name,
        version: readVersion(pluginPath),
        description: readDescription(pluginPath),
        path: pluginPath,
        tools: [],
        loadError: err.message,
      });
    }
  }

  return results;
}

/**
 * Discover plugins and return metadata for each — source (npm/local), package name,
 * version (from package.json), and the tools they provide (name, description, riskLevel).
 *
 * Does not modify the loaded tool registry; this is a separate read-only enumeration
 * intended for the web UI's Plugins tile.
 *
 * @param {{ importFn?: Function }} options
 * @returns {Promise<Array>}
 */
export async function loadPluginMetadata({ importFn = async (p) => import(p) } = {}) {
  const npm = await loadNpmPluginMetadata(importFn);
  const local = await loadLocalPluginMetadata(importFn);
  return [...npm, ...local];
}
