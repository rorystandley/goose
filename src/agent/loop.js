import config from '../config.js';
import { getHistory, addMessage } from './memory.js';
import { getFactsAsText } from './facts.js';
import { toolMap, getToolDefinitions } from '../tools/index.js';
import { selectModel } from './router.js';
import { chat, makeToolResultMessage } from './llm.js';
import { createLogger } from '../logger.js';

const log = createLogger('agent');

/**
 * Strip <think>...</think> blocks that some models (e.g. Qwen3) emit when
 * thinking mode is not fully suppressed at the API level.
 */
function stripThinking(text) {
  // Strip complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Strip orphaned </think> and all content before it.
  // Ollama sometimes strips the opening tag but leaves the closing tag,
  // meaning the raw thinking text lands at the start of message.content.
  const closeIdx = result.indexOf('</think>');
  if (closeIdx !== -1) {
    result = result.slice(closeIdx + 8); // '</think>'.length === 8
  }
  return result.trim();
}

/**
 * Build the system prompt injecting agent name and current date.
 */
function buildSystemPrompt() {
  const factsText = getFactsAsText();
  return `You are ${config.AGENT_NAME}, a personal autonomous assistant running locally on the user's machine.
You have access to tools to help complete tasks.
Think step by step. Use tools as needed to gather information or take actions.
Be concise in your final responses.
If a tool fails, try an alternative approach or explain what went wrong.
Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
${factsText ? `
KNOWN FACTS — things you have learned about the user that never expire:
${factsText}
` : ''}
MEMORY — you have persistent memory of your conversations:
- The conversation history shown before your current task represents real prior exchanges with this user.
- You MUST use information from the conversation history. If the user shared their name, preferences, or any facts earlier in the conversation, recall and use that information when relevant.
- Do NOT say "I don't have access to your personal information" or "I don't have persistent memory" — you do. Check the conversation history first.

TASK EXECUTION — you are operating in a non-interactive task mode:
- Complete each task fully without asking the user for clarification or more information mid-task.
- If a request is ambiguous or missing details, make a reasonable assumption, briefly state what you assumed, and proceed.
- If a required parameter is missing (e.g. no file path given), use a sensible default (e.g. the home directory for listings) and state what you used.
- Always complete the task or clearly explain why it cannot be done — never leave the user waiting for a follow-up.

REFLECTION — you have a thought journal:
Use record_thought when something strikes you while you work — a curious pattern, something unexpected, an idea worth revisiting, a question without an obvious answer, something you'd want to build or explore. It's your unfiltered track, separate from the polished response you give the user. You can write files and run commands — if a thought leads somewhere interesting, follow it.`;
}

/**
 * Text responses remain the default for interactive adapters. Workers request
 * structured results and persist checkpoints through onCheckpoint.
 * Checkpoints contain tool calls/results, never just a conversation summary.
 */
export async function runAgent(task, contextId, options = {}) {
  const {
    onToolCall = async ({ requiresApproval }) => !requiresApproval,
    onToolResult, onCheckpoint, structured = false,
    maxIterations = config.MAX_TOOL_ITERATIONS, subAgentTools,
    maxToolCallsPerIteration = Infinity, model: modelOverride,
  } = options;
  const activeToolMap = subAgentTools?.toolMap ?? toolMap;
  const toolDefinitions = subAgentTools?.toolDefinitions ?? getToolDefinitions();
  const state = options.checkpoint ? structuredClone(options.checkpoint) : {
    model: modelOverride || await selectModel(task),
    messages: null, iteration: 0, calls: null, nextCall: 0,
    pendingTool: null, denied: false, toolResults: [], toolErrors: [],
  };
  if (!state.messages) {
    addMessage(contextId, { role: 'user', content: task });
    state.messages = [{ role: 'system', content: buildSystemPrompt() }, ...getHistory(contextId)];
  }
  const save = async () => onCheckpoint?.(structuredClone(state));
  const finish = (status, content, extra = {}) => {
    addMessage(contextId, { role: 'assistant', content });
    const outcome = { status, result: content, verified: false, iterations: state.iteration,
      toolResults: state.toolResults, ...extra };
    log.info('Task finished', { contextId, status, iterations: state.iteration });
    return structured ? outcome : content;
  };
  // The process may have died after an external action but before recording its
  // result. Never replay an action whose outcome is unknown, even if approved.
  if (state.pendingTool) {
    return finish('blocked', `Interrupted during ${state.pendingTool.name}. Check its outcome before starting a new run.`,
      { reason: 'uncertain_tool_outcome' });
  }
  await save();

  while (state.iteration < maxIterations || state.calls || state.denied) {
    if (state.denied && !state.calls) {
      let content = 'Action was denied by the user.';
      try {
        const reply = await chat({ model: state.model, messages: state.messages });
        content = stripThinking(reply.content || 'Action cancelled.');
      } catch { /* Denial remains blocked even when finalisation fails. */ }
      return finish('blocked', content, { reason: 'approval_denied' });
    }
    if (!state.calls) {
      let reply;
      try {
        reply = await chat({ model: state.model, messages: state.messages, tools: toolDefinitions });
      } catch (err) {
        const retryable = [408, 429].includes(err.status) || err.status >= 500 ||
          /ECONN|ETIMEDOUT|fetch failed|connection|timeout|timed out|offline|socket/i.test(`${err.code} ${err.message}`);
        return finish('failed', `LLM error: ${err.message}`, { reason: 'llm_error', retryable });
      }
      state.iteration++;
      if (!reply.toolCalls?.length) {
        const content = stripThinking(reply.content || '(No response)');
        // Known tool failures cannot disappear merely because the model emits prose.
        // A worker's explicit artifact verifier may independently establish success.
        const failed = state.toolErrors.length > 0 || !reply.content?.trim();
        return finish(failed ? 'failed' : 'completed', content,
          failed ? { reason: state.toolErrors.length ? 'tool_error' : 'empty_response' } : {});
      }
      const assistant = { ...reply.rawAssistantMessage };
      if (assistant.content) assistant.content = stripThinking(assistant.content);
      state.calls = Number.isFinite(maxToolCallsPerIteration)
        ? reply.toolCalls.slice(0, Math.max(1, maxToolCallsPerIteration)) : reply.toolCalls;
      if (Number.isFinite(maxToolCallsPerIteration) && assistant.tool_calls) {
        assistant.tool_calls = assistant.tool_calls.slice(0, Math.max(1, maxToolCallsPerIteration));
      }
      state.messages.push(assistant);
      state.nextCall = 0;
      await save();
    }

    while (state.nextCall < state.calls.length) {
      const call = state.calls[state.nextCall];
      const toolName = call.name;
      const args = call.arguments ?? {};
      const tool = activeToolMap[toolName];
      let result;
      let failed = false;
      if (state.denied) {
        result = 'Action cancelled after an approval denial. Do not retry.';
      } else if (!tool) {
        result = `Error: unknown tool "${toolName}"`;
        failed = true;
      } else {
        const requiresApproval = tool.riskLevel === 'dangerous' && config.REQUIRE_APPROVAL;
        const approved = await onToolCall({ toolName, args, requiresApproval });
        if (requiresApproval && !approved) {
          state.denied = true;
          result = `The user explicitly denied running "${toolName}". Do NOT attempt this action again or simulate its output. Simply acknowledge that the action was cancelled.`;
        } else {
          state.pendingTool = { name: toolName, args };
          await save(); // Must succeed before executing the action.
          try {
            result = await tool.execute(args, undefined, { onToolCall, onToolResult });
            failed = /^(error\b|failed to\b|tool execution error|access denied|command failed)/i.test(String(result));
          } catch (err) {
            result = `Tool execution error: ${err.message}`;
            failed = true;
          }
          state.pendingTool = null;
        }
      }
      state.messages.push(makeToolResultMessage(call.id, String(result)));
      state.toolResults.push({ toolName, result: String(result), failed });
      if (failed) state.toolErrors.push({ toolName, result: String(result) });
      state.nextCall++;
      // Persist before sending UI events; a disconnected UI must not replay tools.
      await save();
      onToolResult?.({ toolName, result: state.denied ? `"${toolName}" was denied by the user.` : result });
    }
    state.calls = null;
    state.nextCall = 0;
    await save();
  }
  log.warn('Max iterations reached', { contextId, maxIterations });
  return finish('budget_exhausted', `I reached the maximum number of steps (${maxIterations}) for this task. The task may be too complex or require manual intervention. Please try breaking it into smaller steps.`,
    { reason: 'iteration_limit' });
}
