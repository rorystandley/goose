/**
 * System monitor — polls CPU usage or memory usage at a configured interval.
 *
 * Supported metrics:
 *   "cpu"    — average CPU usage percentage across all cores (0–100)
 *   "memory" — percentage of total memory currently in use (0–100)
 *
 * Triggers when the measured value exceeds `monitor.threshold`.
 *
 * Exported shape:
 *   { type: 'system', check(monitor) → { triggered, vars } }
 */

import os from 'os';

/**
 * Returns average CPU usage % across all cores (based on os.cpus() idle/total).
 * @returns {number} 0–100
 */
export function getCpuPercent() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  return Math.round(100 - (100 * totalIdle) / totalTick);
}

/**
 * Returns memory usage % (used / total * 100).
 * @returns {number} 0–100
 */
export function getMemoryPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

/**
 * Perform a single system metric check.
 *
 * @param {object} monitor  - monitor config (must have .metric and .threshold)
 * @returns {{ triggered: boolean, vars: object }}
 */
export function check(monitor) {
  const { metric, threshold } = monitor;

  let value;
  if (metric === 'cpu') {
    value = getCpuPercent();
  } else if (metric === 'memory') {
    value = getMemoryPercent();
  } else {
    return { triggered: false, vars: { metric, value: 0, threshold: threshold ?? 0 } };
  }

  const triggered = value >= (threshold ?? 0);

  return {
    triggered,
    vars: {
      metric,
      value: String(value),
      threshold: String(threshold ?? 0),
    },
  };
}

export const type = 'system';
