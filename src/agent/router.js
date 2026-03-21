import config from '../config.js';
import { chat as llmChat } from './llm.js';
import { createLogger } from '../logger.js';

const log = createLogger('router');

// ---------------------------------------------------------------------------
// Keywords that signal a complex / multi-step task → SMART_MODEL
// ---------------------------------------------------------------------------
const SMART_KEYWORDS = [
  'debug', 'refactor', 'analyze', 'analyse', 'implement', 'write',
  'create', 'build', 'review', 'compare', 'optimize', 'optimise',
  'explain why', 'how does', 'architecture', 'design', 'investigate',
  'research', 'summarise', 'summarize', 'generate', 'rewrite', 'migrate',
];

// Keywords that strongly signal a simple / fast task → FAST_MODEL
const FAST_KEYWORDS = [
  'what is', 'what\'s', 'who is', 'who\'s', 'when is', 'when was',
  'where is', 'tell me', 'list ', 'show me', 'how many', 'what time',
  'what date', 'convert ', 'translate ',
];

// ---------------------------------------------------------------------------
// Heuristic routing — no LLM call needed
// ---------------------------------------------------------------------------
function heuristicRoute(task) {
  const t = task.toLowerCase().trim();

  // Smart signals take priority
  for (const kw of SMART_KEYWORDS) {
    if (t.includes(kw)) {
      log.debug('Heuristic → smart (keyword match)', { keyword: kw });
      return config.SMART_MODEL;
    }
  }

  // Long task → smart
  if (task.length > 150) {
    log.debug('Heuristic → smart (task length)', { length: task.length });
    return config.SMART_MODEL;
  }

  // Multi-step phrases → smart
  if (/\b(then|after that|because|however|in addition|first.{0,30}then)\b/i.test(t)) {
    log.debug('Heuristic → smart (multi-step phrase)');
    return config.SMART_MODEL;
  }

  // Fast signals
  for (const kw of FAST_KEYWORDS) {
    if (t.includes(kw)) {
      log.debug('Heuristic → fast (keyword match)', { keyword: kw });
      return config.FAST_MODEL;
    }
  }

  // Short question → fast
  if (task.length < 50) {
    log.debug('Heuristic → fast (short task)', { length: task.length });
    return config.FAST_MODEL;
  }

  // Default: smart (safe fallback)
  log.debug('Heuristic → smart (default)');
  return config.SMART_MODEL;
}

// ---------------------------------------------------------------------------
// Strong-smart pre-filter — definite SMART signals that the small routing
// model might miss (keyword match, very long task, or multi-step phrasing)
// ---------------------------------------------------------------------------
function hasSmartSignal(task) {
  const t = task.toLowerCase().trim();
  for (const kw of SMART_KEYWORDS) {
    if (t.includes(kw)) return true;
  }
  if (task.length > 150) return true;
  if (/\b(then|after that|because|however|in addition|first.{0,30}then)\b/i.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Strong-fast pre-filter — definite FAST signals (keyword match or short task)
// ---------------------------------------------------------------------------
function hasFastSignal(task) {
  const t = task.toLowerCase().trim();
  for (const kw of FAST_KEYWORDS) {
    if (t.includes(kw)) return true;
  }
  if (task.length < 50) return true;
  return false;
}

// ---------------------------------------------------------------------------
// AI routing — calls ROUTING_MODEL to score the task 1–10
// ---------------------------------------------------------------------------
async function aiRoute(task) {
  const prompt = `Rate the complexity of this task on a scale of 1 to 10. Reply with a single number only — no explanation.\n\nTask: ${task}`;
  try {
    const result = await llmChat({
      model: config.ROUTING_MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw   = (result.content || '').trim();
    const score = parseFloat(raw);
    if (isNaN(score)) {
      log.warn('Routing model returned non-numeric score — falling back to smart', { raw });
      return config.SMART_MODEL;
    }
    const chosen = score >= 6 ? config.SMART_MODEL : config.FAST_MODEL;
    log.debug('AI routing result', { score, chosen });
    return chosen;
  } catch (err) {
    log.warn('Routing model call failed — falling back to smart', { error: err.message });
    return config.SMART_MODEL;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the appropriate Ollama model for the given task.
 *
 * Routing is disabled (returns OLLAMA_MODEL) when FAST_MODEL and SMART_MODEL
 * are both empty — preserving existing behaviour with zero overhead.
 *
 * When routing is enabled:
 * - If ROUTING_MODEL is set, calls it to score the task 1–10
 * - Otherwise uses keyword/length heuristics
 *
 * @param {string} task — the user's task string
 * @returns {Promise<string>} — the model name to pass to ollama.chat()
 */
export async function selectModel(task) {
  // Routing disabled — both models must be configured to activate
  if (!config.FAST_MODEL && !config.SMART_MODEL) {
    return config.OLLAMA_MODEL;
  }

  // ROUTING_MODEL set but models not configured — still disabled
  if (!config.FAST_MODEL || !config.SMART_MODEL) {
    log.warn('Multi-model routing partially configured — set both FAST_MODEL and SMART_MODEL to enable');
    return config.OLLAMA_MODEL;
  }

  let chosen;
  if (config.ROUTING_MODEL) {
    // Pre-filter: if the task has a definite SMART signal (keyword / length /
    // multi-step phrase), trust the heuristic and skip the AI routing call.
    // The small routing model is unreliable for tasks with clear complexity cues.
    if (hasSmartSignal(task))     chosen = config.SMART_MODEL;
    else if (hasFastSignal(task)) chosen = config.FAST_MODEL;
    else                          chosen = await aiRoute(task); // ambiguous mid-range → AI router
  } else {
    chosen = heuristicRoute(task);
  }

  log.info('Model selected', { model: chosen });
  return chosen;
}
