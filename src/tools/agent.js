/**
 * Multi-agent tools — delegate_task and parallel_delegate.
 *
 * These tools let the orchestrator LLM spawn sub-agents for complex tasks
 * that benefit from parallelism or specialisation. Sub-agents run the same
 * runAgent() loop but with a filtered tool set (no agent tools — prevents
 * recursive spawning) and a capped iteration limit.
 *
 * Circular dependency note: agent/loop.js imports tools/index.js, which
 * imports this file (agent.js). To break the cycle, we use dynamic imports
 * inside execute() and getSubAgentTools() rather than top-level imports.
 */

// Tool names that are safe for sub-agents to use.
// Agent tools are excluded to prevent recursive sub-agent spawning.
const AGENT_TOOL_NAMES = new Set(['delegate_task', 'parallel_delegate']);

/**
 * Build a sub-agent tool set, optionally filtered to a specific allowlist.
 * Uses a dynamic import to avoid the index.js ↔ agent.js circular dependency.
 *
 * @param {string[] | undefined} allowedToolNames
 *   If provided, only these tools are included (intersected with the safe list).
 *   If omitted, all safe tools are included.
 * @returns {Promise<{ toolMap: Object, toolDefinitions: Object[] }>}
 */
export async function getSubAgentTools(allowedToolNames) {
  const { tools } = await import('./index.js');
  const safeTools = tools.filter(t => !AGENT_TOOL_NAMES.has(t.name));

  const filtered = allowedToolNames
    ? safeTools.filter(t => allowedToolNames.includes(t.name))
    : safeTools;

  return {
    toolMap: Object.fromEntries(filtered.map(t => [t.name, t])),
    toolDefinitions: filtered.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
}

// ---------------------------------------------------------------------------
// delegate_task
// ---------------------------------------------------------------------------

export const delegate_task = {
  name: 'delegate_task',
  description:
    'Delegate a task to a sub-agent with its own context and tool set. ' +
    'Use this when you need to hand off a self-contained piece of work — ' +
    'research, summarisation, file operations, etc. — and wait for the result ' +
    'before continuing. The sub-agent cannot spawn further sub-agents.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The task to delegate. Be specific — the sub-agent has no prior context.',
      },
      context_id: {
        type: 'string',
        description:
          'Optional memory context ID for the sub-agent. ' +
          'If omitted, an ephemeral ID is generated (no persistent memory).',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of tool names the sub-agent is allowed to use. ' +
          'If omitted, all safe tools are available.',
      },
      max_iterations: {
        type: 'number',
        description: 'Maximum tool-call iterations for the sub-agent (1–5, default 5).',
      },
    },
    required: ['task'],
  },
  riskLevel: 'moderate',

  async execute(args, _unused, callbacks = {}) {
    const { runAgent } = await import('../agent/loop.js');

    const subAgentTools = await getSubAgentTools(args.allowed_tools);
    const contextId     = args.context_id ?? `sub-agent-${Date.now()}`;
    const maxIterations = Math.min(args.max_iterations ?? 5, 5);

    const result = await runAgent(args.task, contextId, { ...callbacks, subAgentTools, maxIterations, structured: true });
    return typeof result === 'string' ? result : result.status === 'completed'
      ? result.result : `Error: delegated task ${result.status}: ${result.result}`;
  },
};

// ---------------------------------------------------------------------------
// parallel_delegate
// ---------------------------------------------------------------------------

export const parallel_delegate = {
  name: 'parallel_delegate',
  description:
    'Run multiple sub-agents in parallel and collect all their results. ' +
    'Use this when you have independent tasks that can execute concurrently — ' +
    'e.g. researching several topics simultaneously. Returns a JSON array of ' +
    '{ task, result } objects once all agents complete. Capped at 4 agents.',
  parameters: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        description: 'List of sub-agent specs to run in parallel (max 4).',
        items: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task for this sub-agent.',
            },
            context_id: {
              type: 'string',
              description: 'Optional memory context ID (ephemeral if omitted).',
            },
            allowed_tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tool allowlist for this sub-agent.',
            },
            max_iterations: {
              type: 'number',
              description: 'Max iterations for this sub-agent (1–5, default 5).',
            },
          },
          required: ['task'],
        },
      },
    },
    required: ['agents'],
  },
  riskLevel: 'moderate',

  async execute(args, _unused, callbacks = {}) {
    if (!args.agents?.length) {
      return 'Error: parallel_delegate requires at least one agent spec in the agents array.';
    }

    const { runAgent } = await import('../agent/loop.js');

    const agentSpecs = args.agents.slice(0, 4);

    const results = await Promise.all(
      agentSpecs.map(async spec => {
        const subAgentTools = await getSubAgentTools(spec.allowed_tools);
        const contextId     = spec.context_id ?? `sub-agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const maxIterations = Math.min(spec.max_iterations ?? 5, 5);

        const outcome = await runAgent(spec.task, contextId, { ...callbacks, subAgentTools, maxIterations, structured: true });
        const result = typeof outcome === 'string' ? outcome : outcome.result;
        return { task: spec.task, result, ...(typeof outcome === 'object' ? { status: outcome.status } : {}) };
      }),
    );

    const failed = results.some(r => r.status && r.status !== 'completed');
    return `${failed ? 'Error: one or more delegated tasks did not complete.\n' : ''}${JSON.stringify(results, null, 2)}`;
  },
};
