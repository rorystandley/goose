import { createApproval } from '../../agent/approvals.js';
import { toolMap } from '../../tools/index.js';
import { write as sseWrite, broadcast } from './sse.js';

/**
 * Factory that creates runAgent callbacks wired to SSE for a given contextId.
 * Mirrors the pattern in src/interfaces/cli/index.js.
 */
export function makeCallbacks(contextId) {
  return {
    onToolCall: async ({ toolName, args, requiresApproval }) => {
      if (!requiresApproval) {
        const riskLevel = toolMap[toolName]?.riskLevel ?? 'safe';
        sseWrite(contextId, 'toolCall', { toolName, args, requiresApproval: false, riskLevel });
        return true;
      }

      // Dangerous tool — suspend the agent loop until the user approves/denies
      const { id: approvalId, promise } = createApproval({ tool: toolName, args });
      const riskLevel = toolMap[toolName]?.riskLevel ?? 'dangerous';
      sseWrite(contextId, 'toolCall', { toolName, args, requiresApproval: true, approvalId, riskLevel });
      return promise;
    },

    onToolResult: ({ toolName, result }) => {
      const preview = String(result).slice(0, 500);
      sseWrite(contextId, 'toolResult', { toolName, result: preview });
    },
  };
}

export function makeKanbanCallbacks(contextId, task) {
  if (task.allowDangerous) {
    // Auto-approve — no user interaction required
    return {
      onToolCall: async () => true,
      onToolResult: ({ toolName, result }) => {
        sseWrite(contextId, 'toolResult', { toolName, result: String(result).slice(0, 500) });
      },
    };
  }

  // Default: gate dangerous tools via a broadcast approval request
  return {
    onToolCall: async ({ toolName, args, requiresApproval }) => {
      const riskLevel = toolMap[toolName]?.riskLevel ?? 'safe';
      if (!requiresApproval) {
        // Safe/moderate — stream to the kanban task's contextId (for View Live)
        sseWrite(contextId, 'toolCall', { toolName, args, requiresApproval: false, riskLevel });
        return true;
      }
      // Dangerous — broadcast to every connected browser so the user can see it
      const { id: approvalId, promise } = createApproval({ tool: toolName, args });
      broadcast('kanbanApproval', { taskId: task.id, toolName, args, approvalId, riskLevel });
      return promise;
    },
    onToolResult: ({ toolName, result }) => {
      sseWrite(contextId, 'toolResult', { toolName, result: String(result).slice(0, 500) });
    },
  };
}
