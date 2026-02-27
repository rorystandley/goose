import fs from 'fs';
import { runAgent } from '../agent/loop.js';
import { createLogger } from '../logger.js';
import config from '../config.js';
import { check as checkUrl } from './types/url.js';
import { check as checkFile } from './types/file.js';
import { check as checkSystem } from './types/system.js';

const log = createLogger('monitors');

// ---------------------------------------------------------------------------
// Interval parser
// ---------------------------------------------------------------------------

/**
 * Parse a human-readable interval string into milliseconds.
 * Supports: "30s", "5m", "2h", "1d" — defaults to minutes if no unit.
 *
 * @param {string|number} value
 * @returns {number} milliseconds
 */
export function parseInterval(value) {
  if (typeof value === 'number') return value;
  const str = String(value).trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!match) return 5 * 60 * 1000; // default 5 minutes

  const n = parseFloat(match[1]);
  const unit = match[2] || 'm';
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Math.round(n * multipliers[unit]);
}

// ---------------------------------------------------------------------------
// Task interpolation
// ---------------------------------------------------------------------------

/**
 * Replace {placeholder} tokens in a task string with values from vars.
 *
 * @param {string} template
 * @param {object} vars
 * @returns {string}
 */
export function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ---------------------------------------------------------------------------
// Monitor loader
// ---------------------------------------------------------------------------

/**
 * Load monitors from the configured MONITORS_PATH.
 * Returns an empty array if the file doesn't exist or is malformed.
 */
export function loadMonitors() {
  try {
    const raw = fs.readFileSync(config.MONITORS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.monitors) ? parsed.monitors : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Headless callbacks — no human in the loop
// ---------------------------------------------------------------------------

/**
 * Build the runAgent callbacks for a monitor trigger.
 * Dangerous tools are denied by default (MONITORS_ALLOW_DANGEROUS=false).
 */
export function makeMonitorCallbacks(monitorName) {
  return {
    onToolCall: async ({ toolName, requiresApproval }) => {
      if (requiresApproval && !config.MONITORS_ALLOW_DANGEROUS) {
        log.warn('Dangerous tool denied in monitor', { monitor: monitorName, tool: toolName });
        return false;
      }
      log.debug('Tool executing', { monitor: monitorName, tool: toolName });
      return true;
    },
    onToolResult: ({ toolName, result }) => {
      log.debug('Tool result', {
        monitor: monitorName,
        tool: toolName,
        preview: String(result).slice(0, 100),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Monitor start
// ---------------------------------------------------------------------------

/**
 * Load monitors from disk and start polling intervals for each enabled monitor.
 *
 * @param {Function|null} notify  Optional async (channel, monitorName, result) => void.
 * @returns {Array}  Array of interval IDs (for cleanup / testing).
 */
export function startMonitors(notify = null) {
  const monitors = loadMonitors();

  if (monitors.length === 0) {
    log.info('No monitors loaded — create data/monitors.json to configure watchers', {
      path: config.MONITORS_PATH,
    });
    return [];
  }

  // Per-monitor mutable state: type-specific check state + cooldown tracking
  const states = new Map();
  const lastTriggered = new Map();
  const intervalIds = [];

  const checkers = { url: checkUrl, file: checkFile, system: checkSystem };

  for (const monitor of monitors) {
    if (!monitor.enabled) {
      log.info('Monitor skipped (disabled)', { name: monitor.name });
      continue;
    }

    const checker = checkers[monitor.type];
    if (!checker) {
      log.warn('Unknown monitor type — skipped', { name: monitor.name, type: monitor.type });
      continue;
    }

    const intervalMs = parseInterval(monitor.interval || '5m');
    const cooldownMs = parseInterval(monitor.cooldown || '10m');
    const contextId = monitor.contextId || `monitor-${monitor.name}`;
    const state = {};
    states.set(monitor.name, state);

    log.info('Monitor started', {
      name: monitor.name,
      type: monitor.type,
      intervalMs,
      cooldownMs,
    });

    const id = setInterval(async () => {
      let result;
      try {
        result = monitor.type === 'url'
          ? await checker(monitor, state)
          : checker(monitor, state);
      } catch (err) {
        log.error('Monitor check failed', { name: monitor.name, error: err.message });
        return;
      }

      if (!result.triggered) return;

      // Cooldown check — skip if we triggered too recently
      const last = lastTriggered.get(monitor.name) || 0;
      const now = Date.now();
      if (now - last < cooldownMs) {
        log.debug('Monitor cooldown active — trigger suppressed', { name: monitor.name });
        return;
      }
      lastTriggered.set(monitor.name, now);

      const task = interpolate(monitor.task, result.vars);
      log.info('Monitor triggered', { name: monitor.name, vars: result.vars });

      try {
        const agentResult = await runAgent(task, contextId, makeMonitorCallbacks(monitor.name));
        log.info('Monitor agent complete', { name: monitor.name, responseChars: agentResult.length });

        if (notify && monitor.slackChannel) {
          await notify(monitor.slackChannel, monitor.name, agentResult);
        }
      } catch (err) {
        log.error('Monitor agent failed', { name: monitor.name, error: err.message });
      }
    }, intervalMs);

    intervalIds.push(id);
  }

  return intervalIds;
}

/**
 * Stop all monitor intervals. Primarily used in tests and CLI cleanup.
 *
 * @param {Array} intervalIds  Array returned by startMonitors()
 */
export function stopMonitors(intervalIds = []) {
  for (const id of intervalIds) {
    clearInterval(id);
  }
}
