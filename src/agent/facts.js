import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('facts');

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function load() {
  try {
    return JSON.parse(fs.readFileSync(config.FACTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(store) {
  try {
    fs.mkdirSync(path.dirname(config.FACTS_PATH), { recursive: true });
    fs.writeFileSync(config.FACTS_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    log.error('Failed to persist facts', { error: err.message });
  }
}

// Module-level store — loaded once at init
let facts = load();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return a shallow copy of all known facts. */
export function getFacts() {
  return { ...facts };
}

/** Store or overwrite a single fact and persist to disk. */
export function setFact(key, value) {
  facts[key] = value;
  save(facts);
}

/**
 * Format all facts as a bullet list for system prompt injection.
 * Returns null if no facts have been stored yet.
 */
export function getFactsAsText() {
  const entries = Object.entries(facts);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}
