import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import config from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('memory');

const MAX_MESSAGES = 20;

// ---------------------------------------------------------------------------
// DB path — resolved relative to this file so it's stable regardless of CWD
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, config.MEMORY_DB_PATH);

// Ensure the directory exists before opening (handles first run)
mkdirSync(dirname(dbPath), { recursive: true });

log.info('Opening memory DB', { path: dbPath });

// ---------------------------------------------------------------------------
// Open DB, enable WAL mode, create schema
// ---------------------------------------------------------------------------
const db = new Database(dbPath);

// WAL: reads never block writes, writes never block reads
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    context_id TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_context_id
    ON messages (context_id);
`);

// ---------------------------------------------------------------------------
// Prepared statements — compiled once at startup, reused on every call
// ---------------------------------------------------------------------------
const stmtSelect = db.prepare(`
  SELECT role, content
  FROM   messages
  WHERE  context_id = ?
  ORDER  BY id ASC
`);

const stmtInsert = db.prepare(`
  INSERT INTO messages (context_id, role, content) VALUES (?, ?, ?)
`);

// Keep only the most recent MAX_MESSAGES rows per context
const stmtTrim = db.prepare(`
  DELETE FROM messages
  WHERE  context_id = ?
    AND  id NOT IN (
      SELECT id FROM messages
      WHERE  context_id = ?
      ORDER  BY id DESC
      LIMIT  ${MAX_MESSAGES}
    )
`);

const stmtDelete = db.prepare(`
  DELETE FROM messages WHERE context_id = ?
`);

// ---------------------------------------------------------------------------
// Public API — synchronous, matches the in-memory interface exactly
// ---------------------------------------------------------------------------

/**
 * Get the full conversation history for a context.
 * Returns an empty array if no history exists yet.
 *
 * @param {string} contextId - Channel ID or user ID
 * @returns {{ role: string, content: string }[]}
 */
export function getHistory(contextId) {
  const rows = stmtSelect.all(contextId);
  log.debug('History read', { contextId, messages: rows.length });
  return rows.map(r => ({ role: r.role, content: r.content }));
}

/**
 * Append a message to a context's history and trim to MAX_MESSAGES.
 *
 * @param {string} contextId - Channel ID or user ID
 * @param {{ role: string, content: string }} message
 */
export function addMessage(contextId, message) {
  stmtInsert.run(contextId, message.role, String(message.content ?? ''));
  stmtTrim.run(contextId, contextId);
  log.debug('Message added', { contextId, role: message.role });
}

/**
 * Delete all conversation history for a context.
 *
 * @param {string} contextId - Channel ID or user ID
 */
export function clearHistory(contextId) {
  const result = stmtDelete.run(contextId);
  log.info('History cleared', { contextId, deletedRows: result.changes });
}
