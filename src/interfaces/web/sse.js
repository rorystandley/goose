import { createLogger } from '../../logger.js';

const log = createLogger('web:sse');

// Map<contextId, Set<writeFn>>
const clients = new Map();

/**
 * Register a new SSE client connection for a contextId.
 */
export function addClient(contextId, writeFn) {
  if (!clients.has(contextId)) {
    clients.set(contextId, new Set());
  }
  clients.get(contextId).add(writeFn);
  log.debug('SSE client connected', { contextId, total: clients.get(contextId).size });
}

/**
 * Remove an SSE client (called on connection close).
 */
export function removeClient(writeFn) {
  for (const [contextId, set] of clients) {
    if (set.has(writeFn)) {
      set.delete(writeFn);
      log.debug('SSE client disconnected', { contextId, remaining: set.size });
      if (set.size === 0) clients.delete(contextId);
      return;
    }
  }
}

/**
 * Emit an SSE event to all clients subscribed to the given contextId.
 * @param {string} contextId
 * @param {string} eventName — e.g. 'toolCall', 'toolResult', 'agentResponse'
 * @param {object} data — will be JSON-serialised
 */
export function write(contextId, eventName, data) {
  const set = clients.get(contextId);
  if (!set || set.size === 0) return;

  const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const writeFn of set) {
    try {
      writeFn(frame);
    } catch {
      // Client write failed — remove it
      set.delete(writeFn);
    }
  }
}

/**
 * Broadcast an SSE event to ALL connected clients across all contextIds.
 * Used for global state changes like kanban board updates.
 * @param {string} eventName
 * @param {object} data — will be JSON-serialised
 */
export function broadcast(eventName, data) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const set of clients.values()) {
    for (const writeFn of set) {
      try {
        writeFn(frame);
      } catch {
        set.delete(writeFn);
      }
    }
  }
}
