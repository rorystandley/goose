/**
 * Lightweight structured logger.
 *
 * Log levels (ascending severity): debug → info → warn → error
 * Set LOG_LEVEL=debug in .env to see everything, or LOG_LEVEL=error for quiet mode.
 * Default: info
 *
 * Output format:
 *   2026-02-22T20:00:00.000Z INFO  [agent]   Task started   { task: '...', contextId: '...' }
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLOR = {
  debug: '\x1b[36m',  // cyan
  info:  '\x1b[32m',  // green
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  dim:   '\x1b[2m',
  reset: '\x1b[0m',
};

const minLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function write(level, namespace, message, data) {
  if (LEVELS[level] < minLevel) return;

  const ts    = new Date().toISOString();
  const col   = COLOR[level] ?? COLOR.reset;
  const lvl   = level.toUpperCase().padEnd(5);
  const ns    = namespace ? `${COLOR.dim}[${namespace}]${COLOR.reset}` : '';
  const dataStr = data !== undefined
    ? ' ' + COLOR.dim + JSON.stringify(data) + COLOR.reset
    : '';

  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${col}${ts} ${lvl}${COLOR.reset} ${ns} ${message}${dataStr}\n`);
}

/**
 * Create a namespaced child logger.
 *
 * Usage:
 *   import { createLogger } from '../logger.js';
 *   const log = createLogger('agent');
 *   log.info('Task started', { task, contextId });
 */
export function createLogger(namespace) {
  return {
    debug: (msg, data) => write('debug', namespace, msg, data),
    info:  (msg, data) => write('info',  namespace, msg, data),
    warn:  (msg, data) => write('warn',  namespace, msg, data),
    error: (msg, data) => write('error', namespace, msg, data),
  };
}

// Root logger (no namespace) for index.js startup messages
export const log = createLogger('');
