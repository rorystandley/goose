import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('plugins');

// ---------------------------------------------------------------------------
// npm package discovery
// ---------------------------------------------------------------------------

/**
 * Attempt to import a single npm package and extract its tools array.
 * Never throws — errors are logged and an empty array is returned.
 */
async function tryLoadNpmPackage(packageName, importFn) {
  try {
    const mod = await importFn(packageName);
    const tools = mod.tools ?? mod.default?.tools ?? [];
    if (!Array.isArray(tools)) {
      log.warn('npm plugin exports.tools is not an array — skipped', { package: packageName });
      return [];
    }
    log.info('npm plugin loaded', { package: packageName, tools: tools.map(t => t.name) });
    return tools;
  } catch (err) {
    log.error('npm plugin failed to load — skipped', { package: packageName, error: err.message });
    return [];
  }
}

/**
 * Scan node_modules for Goose plugins by naming convention:
 *   @goose-plugins/*    — scoped namespace for official / community plugins
 *   goose-plugin-*      — unscoped alternative
 *
 * Any installed package matching either pattern is automatically loaded.
 * No configuration required — install and restart.
 */
async function loadNpmPlugins({ importFn }) {
  const allTools = [];
  const nodeModulesDir = path.join(process.cwd(), 'node_modules');

  if (!fs.existsSync(nodeModulesDir)) return allTools;

  // @goose-plugins/* scoped packages
  // isDirectory() || isSymbolicLink() — npm-linked packages appear as symlinks,
  // real npm installs appear as directories. Both must be accepted.
  const scopeDir = path.join(nodeModulesDir, '@goose-plugins');
  if (fs.existsSync(scopeDir)) {
    const entries = fs.readdirSync(scopeDir, { withFileTypes: true });
    for (const entry of entries.filter(e => e.isDirectory() || e.isSymbolicLink())) {
      allTools.push(...await tryLoadNpmPackage(`@goose-plugins/${entry.name}`, importFn));
    }
  }

  // goose-plugin-* unscoped packages
  const nmEntries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  for (const entry of nmEntries.filter(e => e.isDirectory() && e.name.startsWith('goose-plugin-'))) {
    allTools.push(...await tryLoadNpmPackage(entry.name, importFn));
  }

  return allTools;
}

// ---------------------------------------------------------------------------
// Local plugins/ directory discovery
// ---------------------------------------------------------------------------

/**
 * Scan the local plugins/ directory for subdirectories containing index.js.
 * Useful for personal or in-development plugins that don't need npm publishing.
 */
async function loadLocalPlugins({ importFn }) {
  const pluginsDir = config.PLUGINS_DIR;

  if (!fs.existsSync(pluginsDir)) {
    log.debug('No plugins directory found', { path: pluginsDir });
    return [];
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries.filter(e => e.isDirectory());

  if (pluginDirs.length === 0) {
    log.debug('Plugins directory is empty', { path: pluginsDir });
    return [];
  }

  const allTools = [];

  for (const dir of pluginDirs) {
    const entryPath = path.join(pluginsDir, dir.name, 'index.js');

    if (!fs.existsSync(entryPath)) {
      log.warn('Plugin has no index.js — skipped', { plugin: dir.name, expected: entryPath });
      continue;
    }

    try {
      const mod = await importFn(entryPath);
      const pluginTools = mod.tools ?? mod.default?.tools ?? [];

      if (!Array.isArray(pluginTools)) {
        log.warn('Plugin exports.tools is not an array — skipped', { plugin: dir.name });
        continue;
      }

      log.info('Plugin loaded', {
        plugin: dir.name,
        tools: pluginTools.map(t => t.name),
      });
      allTools.push(...pluginTools);
    } catch (err) {
      log.error('Plugin failed to load — skipped', { plugin: dir.name, error: err.message });
    }
  }

  return allTools;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover and load all plugins — npm packages first, then local plugins/ dir.
 *
 * npm packages: any installed package matching @goose-plugins/* or goose-plugin-*
 * is auto-discovered from node_modules without any configuration.
 * Install the package and restart Goose — it just works.
 *
 * Local plugins: each subdirectory under PLUGINS_DIR containing an index.js
 * is loaded — useful for personal/dev plugins that don't need npm publishing.
 *
 * Both sources share the same plugin interface: export a `tools` array with
 * the standard tool shape (name, description, riskLevel, parameters, execute).
 *
 * @param {{ importFn?: Function }} options
 *   - importFn — injectable import function, defaults to dynamic import().
 *     Override in tests to avoid real file system imports.
 * @returns {Promise<Array>} Flat array of all tool objects from all plugins.
 */
export async function loadPlugins({ importFn = async (p) => import(p) } = {}) {
  const seen = new Set();
  const allTools = [];

  const add = (tools) => {
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        log.warn('Duplicate tool name — skipped', { name: tool.name });
        continue;
      }
      seen.add(tool.name);
      allTools.push(tool);
    }
  };

  add(await loadNpmPlugins({ importFn }));
  add(await loadLocalPlugins({ importFn }));
  return allTools;
}
