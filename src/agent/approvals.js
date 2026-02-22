import { randomUUID } from 'crypto';

// In-memory map of pending approvals: id → { resolve, timeoutId }
const pendingApprovals = new Map();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a pending approval that waits for user action in Slack.
 * Returns { id, promise } where promise resolves to true (approved) or false (denied/timed out).
 */
export function createApproval({ tool, args }) {
  const id = randomUUID();

  const promise = new Promise((resolve) => {
    // Auto-deny after 5 minutes if no response
    const timeoutId = setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        console.warn(`Approval ${id} for tool "${tool}" timed out after 5 minutes — auto-denied.`);
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
    console.warn(`resolveApproval called with unknown or already-resolved id: ${id}`);
    return;
  }
  clearTimeout(entry.timeoutId);
  pendingApprovals.delete(id);
  entry.resolve(approved);
}

/**
 * Check if a given approval ID is still pending.
 */
export function hasPending(id) {
  return pendingApprovals.has(id);
}
