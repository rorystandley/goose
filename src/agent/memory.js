const MAX_MESSAGES = 20;

// In-memory store: contextId (channelId or userId) → message array
const histories = new Map();

/**
 * Get the conversation history for a given context.
 * Returns an empty array if no history exists yet.
 */
export function getHistory(contextId) {
  return histories.get(contextId) ?? [];
}

/**
 * Append a message { role, content } to a context's history.
 * Drops the oldest message if the history exceeds MAX_MESSAGES.
 */
export function addMessage(contextId, message) {
  if (!histories.has(contextId)) {
    histories.set(contextId, []);
  }
  const history = histories.get(contextId);
  history.push(message);
  // Keep only the last MAX_MESSAGES messages
  if (history.length > MAX_MESSAGES) {
    history.shift();
  }
}

/**
 * Clear all conversation history for a context.
 */
export function clearHistory(contextId) {
  histories.delete(contextId);
}
