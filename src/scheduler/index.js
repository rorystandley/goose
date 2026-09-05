import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { executeWorkflow } from '../execution/workflow.js';
import { readRun } from '../execution/store.js';
import { toolMap, initTools } from '../tools/index.js';
import { createLogger } from '../logger.js';
import config from '../config.js';
import { speak } from '../interfaces/voice/tts.js';
import { recordMissionStart, recordMissionComplete, recordMissionFailed } from './state.js';

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

/**
 * Resolve the externally visible mission output once, then reuse it for Slack
 * and optional speech. This keeps spoken briefings aligned with notifications.
 *
 * @param {object} mission
 * @param {string} result
 * @param {string} startTime
 * @returns {string}
 */
function buildMissionOutput(mission, result, startTime) {
  if (mission.postLastThought) {
    return readLastThoughtSince(startTime) ?? result;
  }
  if (mission.notifyFrom) {
    return buildNotifyContent(mission.notifyFrom, result);
  }
  return result;
}

async function speakSafely(text, speechContext) {
  if (!text?.trim()) return;
  try {
    await speak(text, speechContext);
  } catch (err) {
    log.warn('Speech output failed', { ...speechContext, error: err.message });
  }
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
// Direct tool execution — bypass the LLM entirely
// ---------------------------------------------------------------------------

/**
 * Execute a tool directly by name, without involving the LLM.
 *
 * Used for deterministic missions (e.g. backups) where the tool does all the
 * work and the model adds nothing. Set `"direct": "tool_name"` in the mission
 * config. Optional `"directArgs": { ... }` passes arguments to the tool.
 *
 * @param {string} toolName   Name of the registered tool (built-in or plugin)
 * @param {object} args       Arguments to pass to the tool's execute()
 * @returns {string}          The tool's return value
 */
async function executeDirect(toolName, args = {}) {
  const tool = toolMap[toolName];
  if (!tool) throw new Error(`Direct tool not found: ${toolName}`);
  return await tool.execute(args);
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
 * @param {boolean} captureToolResults  When true, raw tool outputs are accumulated
 *   and available via getCapturedResults(). Used by phases with captureToolResults
 *   to bypass the model's text response and pass real data to the next phase.
 */
export function makeSchedulerCallbacks(missionName, allowDangerous = false, captureToolResults = false) {
  const permitted = allowDangerous || config.SCHEDULER_ALLOW_DANGEROUS;
  const capturedResults = [];
  const callbacks = {
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
      if (captureToolResults) {
        capturedResults.push(`--- ${toolName} ---\n${result}`);
      }
    },
    getCapturedResults: () => capturedResults.join('\n\n'),
  };
  return callbacks;
}

/** Limit each phase to the capabilities required by its task. */
export function resolveMissionTools({ noTools, allowedTools } = {}) {
  if (noTools) return { subAgentTools: { toolMap: {}, toolDefinitions: [] } };
  if (allowedTools === undefined) return {};
  if (!Array.isArray(allowedTools) || allowedTools.some(name => typeof name !== 'string' || !Object.hasOwn(toolMap, name))) {
    throw new Error('allowedTools must list installed tool names');
  }
  const selected = [...new Set(allowedTools)].map(name => toolMap[name]);
  return { subAgentTools: {
    toolMap: Object.fromEntries(selected.map(tool => [tool.name, tool])),
    toolDefinitions: selected.map(tool => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.parameters,
    } })),
  } };
}

// ---------------------------------------------------------------------------
// Mission execution
// ---------------------------------------------------------------------------

/**
 * Run a single mission end-to-end: resolve contextId, run direct/phased/single-task,
 * save response if configured, notify Slack, speak output. Records state transitions
 * via scheduler/state.js. Errors are caught and recorded; this function never throws.
 *
 * Same code path used by both scheduled cron firings and manual triggers from the UI.
 *
 * @param {object}   mission
 * @param {object}   options
 * @param {Function} options.notify   async (channel, name, output) => void
 * @param {string}   options.source   'cron' | 'manual' — informational only
 * @returns {{ contextId: string, result: string|null, error: Error|null }}
 */
export async function executeMission(mission, { notify = null, source = 'cron', startNew = false } = {}) {
  const baseContextId = mission.contextId || `mission-${mission.name}`;
  const contextId = mission.freshContext
    ? `${baseContextId}-${Date.now()}`
    : baseContextId;
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  log.info('Mission firing', { name: mission.name, contextId, source });

  recordMissionStart(mission.name);

  let result = null;
  try {
    const stages = mission.direct ? [{
      name: mission.direct,
      direct: async () => {
        const tool = toolMap[mission.direct];
        if (tool?.riskLevel === 'dangerous' && config.REQUIRE_APPROVAL &&
          !(mission.allowDangerous || config.SCHEDULER_ALLOW_DANGEROUS)) {
          throw new Error('Direct tool requires allowDangerous approval');
        }
        return executeDirect(mission.direct, mission.directArgs ?? {});
      },
    }] : mission.phases ? mission.phases.map(phase => ({
      name: phase.name,
      contextId,
      task: previous => phase.injectPreviousResult && previous
        ? `${phase.task}\n\nContext from previous phase:\n${previous}` : phase.task,
      acceptance: phase.acceptance,
      captureToolResults: !!phase.captureToolResults,
      options: {
        ...makeSchedulerCallbacks(mission.name, phase.allowDangerous ?? false),
        ...(phase.maxIterations ? { maxIterations: phase.maxIterations } : {}),
        ...(phase.maxToolCallsPerIteration ? { maxToolCallsPerIteration: phase.maxToolCallsPerIteration } : {}),
        ...resolveMissionTools(phase),
        ...(phase.contextTokens || mission.contextTokens ? { contextTokens: phase.contextTokens || mission.contextTokens } : {}),
        ...(phase.model || mission.model ? { model: phase.model || mission.model } : {}),
      },
    })) : [{
      name: 'execute', task: buildTask(mission), contextId,
      options: {
        ...makeSchedulerCallbacks(mission.name, mission.allowDangerous ?? false),
        ...resolveMissionTools(mission),
        ...(mission.contextTokens ? { contextTokens: mission.contextTokens } : {}),
        ...(mission.maxIterations ? { maxIterations: mission.maxIterations } : {}),
        ...(mission.maxToolCallsPerIteration ? { maxToolCallsPerIteration: mission.maxToolCallsPerIteration } : {}),
        ...(mission.model ? { model: mission.model } : {}),
      },
    }];
    // Persist the save as a workflow stage so output-write failures cannot be
    // reported as success and previous agent stages need not be repeated.
    if (mission.saveResponseTo) {
      let response;
      stages.push({
        name: 'save-response',
        task: previous => { response = previous; return ''; },
        direct: async () => {
          const savePath = path.join(process.cwd(), mission.saveResponseTo);
          fs.mkdirSync(path.dirname(savePath), { recursive: true });
          fs.writeFileSync(savePath, response, 'utf8');
          return response;
        },
        acceptance: [{ type: 'file', path: mission.saveResponseTo, allowUnchanged: true }],
      });
    }
    const outcome = await executeWorkflow({
      id: `mission:${mission.name}`, definition: mission, stages,
      acceptance: mission.acceptance ?? [], inputs: mission.inputs ?? [], restartCompleted: true, startNew,
      maxAttempts: mission.maxAttempts,
    });
    if (outcome.reason === 'run_locked') return { contextId, result: null, error: null, outcome };
    result = outcome.result;
    if (outcome.status !== 'completed') {
      const err = new Error(result);
      err.outcome = outcome;
      throw err;
    }
    const output = buildMissionOutput(mission, result, startTime);

    if (notify && mission.slackChannel) {
      await notify(mission.slackChannel, mission.name, output);
    }

    if (mission.speakResponse) {
      await speakSafely(output, {
        source: 'mission',
        missionName: mission.name,
        contextId,
      });
    }

    recordMissionComplete(mission.name, { durationMs: Date.now() - startedAt, outcome });
    return { contextId, result, error: null, outcome };
  } catch (err) {
    log.error('Mission failed', { name: mission.name, error: err.message });
    if (mission.speakOnFailure) {
      await speakSafely(
        `Goose mission ${mission.name} failed: ${err.message}`,
        { source: 'mission', missionName: mission.name, contextId, mode: 'failure' },
      );
    }
    recordMissionFailed(mission.name, { error: err.message, durationMs: Date.now() - startedAt, outcome: err.outcome });
    return { contextId, result: null, error: err, outcome: err.outcome };
  }
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
export async function startScheduler(notify = null) {
  // Ensure tool registry is populated (needed for direct missions)
  await initTools();

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
      () => {
        const previous = readRun(`mission:${mission.name}`);
        if (previous && !['running', 'completed'].includes(previous.status)) return;
        return executeMission(mission, { notify, source: 'cron' });
      },
      { timezone: mission.timezone || 'UTC' },
    );

    // Resume an interrupted occurrence immediately; completed occurrences wait
    // for their next cron tick. The disk lock arbitrates multiple processes.
    if (readRun(`mission:${mission.name}`)?.status === 'running') {
      void executeMission(mission, { notify, source: 'recovery' });
    }
    tasks.push(task);
    log.info('Mission scheduled', { name: mission.name, cron: mission.cron, contextId: baseContextId });
  }

  return tasks;
}
