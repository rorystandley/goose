import cron from 'node-cron';
import fs from 'fs';
import { runAgent } from '../agent/loop.js';
import { createLogger } from '../logger.js';
import config from '../config.js';

const log = createLogger('scheduler');

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
// Headless callbacks — no human in the loop
// ---------------------------------------------------------------------------

/**
 * Build the runAgent callbacks for a scheduled mission.
 * Dangerous tools are denied by default (SCHEDULER_ALLOW_DANGEROUS=false).
 */
export function makeSchedulerCallbacks(missionName) {
  return {
    onToolCall: async ({ toolName, requiresApproval }) => {
      if (requiresApproval && !config.SCHEDULER_ALLOW_DANGEROUS) {
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
    const contextId = mission.freshContext
      ? `${baseContextId}-${Date.now()}`
      : baseContextId;

    const task = cron.schedule(
      mission.cron,
      async () => {
        const startTime = new Date().toISOString();
        log.info('Mission firing', { name: mission.name, contextId });
        try {
          const result = await runAgent(
            mission.task,
            contextId,
            {
              ...makeSchedulerCallbacks(mission.name),
              ...(mission.maxIterations ? { maxIterations: mission.maxIterations } : {}),
            },
          );
          log.info('Mission complete', { name: mission.name, responseChars: result.length });

          if (notify && mission.slackChannel) {
            let content = result;
            if (mission.postLastThought) {
              content = readLastThoughtSince(startTime) ?? result;
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
    log.info('Mission scheduled', { name: mission.name, cron: mission.cron, contextId });
  }

  return tasks;
}
