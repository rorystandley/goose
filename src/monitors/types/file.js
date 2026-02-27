/**
 * File monitor — polls a file or directory's mtime at a configured interval.
 *
 * Triggers when the mtime has changed since the last check.
 * Uses polling (fs.statSync) rather than fs.watch to avoid platform differences.
 *
 * Exported shape:
 *   { type: 'file', check(monitor, state) → { triggered, vars } }
 */

import fs from 'fs';

/**
 * Perform a single mtime check for the given monitor config.
 *
 * @param {object} monitor  - monitor config object (must have .path)
 * @param {object} state    - mutable state for this monitor (previousMtime)
 * @returns {{ triggered: boolean, vars: object }}
 */
export function check(monitor, state = {}) {
  const { path } = monitor;

  let mtime = null;
  let error = null;

  try {
    mtime = fs.statSync(path).mtimeMs;
  } catch (err) {
    error = err.message;
  }

  const triggered = error === null &&
    state.previousMtime !== undefined &&
    mtime !== state.previousMtime;

  const vars = {
    path,
    mtime: mtime ? new Date(mtime).toISOString() : 'unknown',
    error: error || '',
  };

  if (error === null) {
    state.previousMtime = mtime;
  }

  return { triggered, vars };
}

export const type = 'file';
