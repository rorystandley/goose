import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import config from '../config.js';

const log = createLogger('memory');

const MAX_MESSAGES = 20;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function load() {
  try {
    const raw = fs.readFileSync(config.MEMORY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};  // file doesn't exist yet — start fresh
  }
}

function save(store) {
  try {
    const dir = path.dirname(config.MEMORY_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.MEMORY_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    log.error('Failed to persist memory', { error: err.message });
  }
}

// Load once at module initialisation
let store = load();

// ---------------------------------------------------------------------------
// Public API (identical shape to the in-memory version)
// ---------------------------------------------------------------------------

/**
 * Get the conversation history for a given context.
 * Returns an empty array if no history exists yet.
 */
export function getHistory(contextId) {
  const history = store[contextId] ?? [];
  log.debug('History read', { contextId, messages: history.length });
  return history;
}

/**
 * Append a message { role, content } to a context's history.
 * Drops the oldest message if the history exceeds MAX_MESSAGES.
 * Persists the updated store to disk.
 */
export function addMessage(contextId, message) {
  if (!store[contextId]) store[contextId] = [];
  store[contextId].push(message);
  if (store[contextId].length > MAX_MESSAGES) {
    store[contextId].shift();
  }
  save(store);
  log.debug('Message added', { contextId, role: message.role, historyLength: store[contextId].length });
}

/**
 * Clear all conversation history for a context.
 * Persists the updated store to disk.
 */
export function clearHistory(contextId) {
  const had = Boolean(store[contextId]);
  delete store[contextId];
  save(store);
  log.info('History cleared', { contextId, hadHistory: had });
}

/**
 * Get all context IDs that have stored history.
 */
export function getContextIds() {
  return Object.keys(store);
}
