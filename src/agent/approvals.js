import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';

const log = createLogger('approval');

// In-memory map of pending approvals: id → { resolve, timeoutId, tool, args }
const pendingApprovals = new Map();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a pending approval that waits for user action in Slack.
 * Returns { id, promise } where promise resolves to true (approved) or false (denied/timed out).
 */
export function createApproval({ tool, args }) {
  const id = randomUUID();

  log.info('Approval created', { id, tool, args });

  const promise = new Promise((resolve) => {
    // Auto-deny after 5 minutes if no response
    const timeoutId = setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        log.warn('Approval timed out — auto-denied', { id, tool });
        resolve(false);
      }
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(id, { resolve, timeoutId, tool, args });
  });

  return { id, promise };
}

/**
 * Resolve an approval by its ID.
 * Called by the Slack button interaction handler.
 */
export function resolveApproval(id, approved) {
  const entry = pendingApprovals.get(id);
  if (!entry) {
    log.warn('resolveApproval called for unknown or already-resolved id', { id });
    return;
  }
  clearTimeout(entry.timeoutId);
  pendingApprovals.delete(id);
  log.info('Approval resolved', { id, tool: entry.tool, approved });
  entry.resolve(approved);
}

/**
 * Check if a given approval ID is still pending.
 */
export function hasPending(id) {
  return pendingApprovals.has(id);
}
