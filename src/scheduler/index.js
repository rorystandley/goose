import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { runAgent } from '../agent/loop.js';
import { createLogger } from '../logger.js';
import config from '../config.js';

const log = createLogger('scheduler');

// ---------------------------------------------------------------------------
// Notification post-processors
// ---------------------------------------------------------------------------

/**
 * Build the notification content for a mission, applying any notifyFrom
 * post-processor specified in the mission config.
 *
 * notifyFrom is a relative file path. The mission/plugin is responsible for
 * writing whatever it wants to notify to that file. The scheduler reads it
 * verbatim. Falls back to the raw runAgent result if the file can't be read.
 *
 * @param {string}      notifyFrom  Relative path from process.cwd() (or undefined)
 * @param {string}      result      Raw runAgent result (fallback)
 * @returns {string}    Notification content
 */
function buildNotifyContent(notifyFrom, result) {
  if (notifyFrom) {
    try {
      return fs.readFileSync(path.join(process.cwd(), notifyFrom), 'utf8').trim();
    } catch {
      // fall through to raw result
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Thought journal helper
// ---------------------------------------------------------------------------

/**
 * Read the last thought recorded to thoughts.jsonl at or after `since` (ISO string).
 * Returns null if the file doesn't exist, is unreadable, or no entry matches.
 */
function readLastThoughtSince(since) {
  try {
    const lines = fs.readFileSync(config.THOUGHTS_PATH, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    const recent = lines
      .map(l => JSON.parse(l))
      .filter(e => e.timestamp >= since);
    return recent.at(-1)?.thought ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mission loader
// ---------------------------------------------------------------------------

/**
 * Load missions from the configured MISSIONS_PATH.
 * Returns an empty array if the file doesn't exist or is malformed.
 */
export function loadMissions() {
  try {
    const raw = fs.readFileSync(config.MISSIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.missions) ? parsed.missions : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Task builder — inject file contents into the task string
// ---------------------------------------------------------------------------

/**
 * All known hook techniques for the marketing twitter pipeline.
 * Used by formatTechniqueList to compute available vs recently-used.
 */
const ALL_TECHNIQUES = [
  'contradiction', 'hot_take', 'stolen_thought', 'micro_story',
  'specific_numbers', 'open_loop', 'pattern_interrupt', 'direct_pain',
];

/**
 * Transform raw hook-history JSON into a plain-text "available vs avoid"
 * list that a 14B model can follow without parsing JSON.
 *
 * This removes the reasoning burden from the model — instead of parsing
 * JSON, counting technique occurrences, and inferring "recently used",
 * the model just picks from a pre-filtered list.
 *
 * @param {string} jsonContent  Raw JSON string from hook-history.json
 * @param {object} opts
 * @param {number} opts.window  Number of recent entries to consider (default: 5)
 * @returns {string}  Plain-text technique list
 */
export function formatTechniqueList(jsonContent, { window = 5 } = {}) {
  let entries = [];
  try {
    entries = JSON.parse(jsonContent).entries ?? [];
  } catch {
    return '(could not parse hook history)';
  }

  const recent = entries.slice(-window);
  const usedSet = new Set(recent.map(e => e.technique));
  const usedCounts = {};
  for (const e of recent) {
    usedCounts[e.technique] = (usedCounts[e.technique] || 0) + 1;
  }

  const avoid = ALL_TECHNIQUES.filter(t => usedSet.has(t));
  const available = ALL_TECHNIQUES.filter(t => !usedSet.has(t));

  const lines = [];
  if (avoid.length) {
    lines.push('Recently used (DO NOT pick these):');
    for (const t of avoid) {
      const count = usedCounts[t];
      lines.push(`- ${t}${count > 1 ? ` (used ${count}x)` : ''}`);
    }
    lines.push('');
  }
  lines.push('Available (pick ONE of these):');
  for (const t of available) {
    lines.push(`- ${t}`);
  }
  return lines.join('\n');
}

/**
 * Build the final task string for a mission, optionally injecting file
 * contents specified by mission.injectFiles.
 *
 * injectFiles is an array of { label, path, transform? } objects. Each file
 * is read and appended to the task string under a labelled header. If a file
 * can't be read (missing, permissions), a fallback note is injected.
 *
 * Supported transforms:
 *   "recentTechniques" — parse hook-history JSON and output a plain-text
 *   available/avoid list. Accepts optional `window` (default 5).
 *
 * This is a lightweight precursor to phase-based missions — it lets the
 * model receive pre-gathered context as text without needing tool calls,
 * avoiding the batching problem where tool arguments are composed before
 * prior tool results are available.
 *
 * @param {object} mission  The mission config object
 * @returns {string}        The fully assembled task string
 */
export function buildTask(mission) {
  if (!mission.injectFiles?.length) return mission.task;

  const sections = mission.injectFiles.map(({ label, path: filePath, transform, ...opts }) => {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8').trim();
      if (transform === 'recentTechniques') {
        return `--- ${label} ---\n${formatTechniqueList(content, opts)}`;
      }
      return `--- ${label} ---\n${content}`;
    } catch {
      return `--- ${label} ---\n(file not available: ${filePath})`;
    }
  });

  return `${mission.task}\n\n${sections.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Headless callbacks — no human in the loop
// ---------------------------------------------------------------------------

/**
 * Build the runAgent callbacks for a scheduled mission.
 *
 * Dangerous tools are denied by default. Opt in at the mission level by
 * setting `"allowDangerous": true` in the mission object (missions.json).
 * The global SCHEDULER_ALLOW_DANGEROUS env var acts as an override that
 * enables dangerous tools for every mission at once — useful for development
 * but not recommended in production.
 *
 * @param {string}  missionName
 * @param {boolean} allowDangerous  Per-mission opt-in from missions.json
 */
export function makeSchedulerCallbacks(missionName, allowDangerous = false) {
  const permitted = allowDangerous || config.SCHEDULER_ALLOW_DANGEROUS;
  return {
    onToolCall: async ({ toolName, requiresApproval }) => {
      if (requiresApproval && !permitted) {
        log.warn('Dangerous tool denied in scheduled mission', { mission: missionName, tool: toolName });
        return false;
      }
      log.debug('Tool executing', { mission: missionName, tool: toolName });
      return true;
    },
    onToolResult: ({ toolName, result }) => {
      log.debug('Tool result', {
        mission: missionName,
        tool: toolName,
        preview: String(result).slice(0, 100),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Scheduler start
// ---------------------------------------------------------------------------

/**
 * Load missions from disk and register cron jobs.
 *
 * @param {Function|null} notify  Optional async (channel, missionName, result) => void.
 *                                Called after each mission completes when mission.slackChannel is set.
 * @returns {Array}  Array of registered ScheduledTask objects.
 */
export function startScheduler(notify = null) {
  const missions = loadMissions();

  if (missions.length === 0) {
    log.info('No missions loaded — create data/missions.json to schedule tasks', {
      path: config.MISSIONS_PATH,
    });
    return [];
  }

  const tasks = [];

  for (const mission of missions) {
    if (!mission.enabled) {
      log.info('Mission skipped (disabled)', { name: mission.name });
      continue;
    }

    if (!cron.validate(mission.cron)) {
      log.warn('Invalid cron expression — mission skipped', {
        name: mission.name,
        cron: mission.cron,
      });
      continue;
    }

    const baseContextId = mission.contextId || `mission-${mission.name}`;

    const task = cron.schedule(
      mission.cron,
      async () => {
        const contextId = mission.freshContext
          ? `${baseContextId}-${Date.now()}`
          : baseContextId;
        const startTime = new Date().toISOString();
        log.info('Mission firing', { name: mission.name, contextId });
        try {
          const result = await runAgent(
            buildTask(mission),
            contextId,
            {
              ...makeSchedulerCallbacks(mission.name, mission.allowDangerous ?? false),
              ...(mission.maxIterations ? { maxIterations: mission.maxIterations } : {}),
              ...(mission.maxToolCallsPerIteration ? { maxToolCallsPerIteration: mission.maxToolCallsPerIteration } : {}),
            },
          );
          log.info('Mission complete', { name: mission.name, responseChars: result.length });

          if (mission.saveResponseTo) {
            try {
              const savePath = path.join(process.cwd(), mission.saveResponseTo);
              fs.mkdirSync(path.dirname(savePath), { recursive: true });
              fs.writeFileSync(savePath, result, 'utf8');
              log.info('Response saved', { name: mission.name, path: mission.saveResponseTo });
            } catch (err) {
              log.error('Failed to save response', { name: mission.name, error: err.message });
            }
          }

          if (notify && mission.slackChannel) {
            let content = result;
            if (mission.postLastThought) {
              content = readLastThoughtSince(startTime) ?? result;
            } else if (mission.notifyFrom) {
              content = buildNotifyContent(mission.notifyFrom, result);
            }
            await notify(mission.slackChannel, mission.name, content);
          }
        } catch (err) {
          log.error('Mission failed', { name: mission.name, error: err.message });
        }
      },
      { timezone: mission.timezone || 'UTC' },
    );

    tasks.push(task);
    log.info('Mission scheduled', { name: mission.name, cron: mission.cron, contextId: baseContextId });
  }

  return tasks;
}
