import { Ollama } from 'ollama';
import config from '../config.js';
import { getHistory, addMessage } from './memory.js';
import { getFactsAsText } from './facts.js';
import { toolMap, getOllamaToolDefinitions } from '../tools/index.js';
import { selectModel } from './router.js';
import { createLogger } from '../logger.js';

const log = createLogger('agent');
const ollama = new Ollama({ host: config.OLLAMA_HOST });

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
 * Core agentic loop.
 *
 * @param {string} task - The user's request
 * @param {string} contextId - Channel or user ID for memory scoping
 * @param {{ onToolCall: Function, onToolResult: Function, maxIterations?: number }} options
 *   - onToolCall({ toolName, args, requiresApproval }) → Promise<boolean>
 *   - onToolResult({ toolName, result }) → void
 *   - maxIterations — override the global MAX_TOOL_ITERATIONS for this run
 * @returns {Promise<string>} The final assistant response
 */
export async function runAgent(task, contextId, options = {}) {
  const { onToolCall, onToolResult, maxIterations = config.MAX_TOOL_ITERATIONS, subAgentTools } = options;
  const taskStart = Date.now();

  // Select the model for this task (honours FAST_MODEL / SMART_MODEL routing if configured)
  const model = await selectModel(task);

  log.info('Task started', { task: task.slice(0, 120), contextId, model });

  // Build the message array: system prompt + conversation history + new user message
  const systemMessage = { role: 'system', content: buildSystemPrompt() };
  const userMessage = { role: 'user', content: task };

  // Persist the user message to memory
  addMessage(contextId, userMessage);

  // Working copy of messages for this run (system + history)
  const history = getHistory(contextId);
  const messages = [systemMessage, ...history];

  log.debug('Context loaded', { contextId, historyLength: history.length });

  const activeToolMap    = subAgentTools ? subAgentTools.toolMap        : toolMap;
  const toolDefinitions  = subAgentTools ? subAgentTools.toolDefinitions : getOllamaToolDefinitions();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    log.debug('LLM call', { iteration, messageCount: messages.length, model });

    const llmStart = Date.now();
    let response;
    try {
      response = await ollama.chat({
        model,
        messages,
        tools: toolDefinitions,
        think: false,
      });
    } catch (err) {
      log.error('LLM call failed', { iteration, error: err.message });
      const errorMsg = `LLM error: ${err.message}`;
      addMessage(contextId, { role: 'assistant', content: errorMsg });
      return errorMsg;
    }

    const llmMs = Date.now() - llmStart;
    const assistantMessage = response.message;
    const hasToolCalls = !!assistantMessage.tool_calls?.length;

    log.debug('LLM response received', {
      iteration,
      durationMs: llmMs,
      type: hasToolCalls ? 'tool_calls' : 'text',
      toolCount: assistantMessage.tool_calls?.length ?? 0,
    });

    // No tool calls — final answer
    if (!hasToolCalls) {
      const content = stripThinking(assistantMessage.content || '(No response)');
      addMessage(contextId, { role: 'assistant', content });
      log.info('Task complete', {
        contextId,
        iterations: iteration + 1,
        durationMs: Date.now() - taskStart,
        responseChars: content.length,
      });
      return content;
    }

    // Push the assistant message (with tool_calls) into the working message array
    messages.push(assistantMessage);

    // Track whether any tool was denied this iteration so we can break the loop cleanly
    let anyDenied = false;

    // Process each tool call in sequence
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function?.name;
      const args = toolCall.function?.arguments ?? {};

      const tool = activeToolMap[toolName];

      // Unknown tool — report back to the LLM
      if (!tool) {
        log.warn('Unknown tool requested', { toolName });
        const errorResult = `Error: unknown tool "${toolName}"`;
        messages.push({ role: 'tool', content: errorResult });
        onToolResult?.({ toolName, result: errorResult });
        continue;
      }

      log.info('Tool call', { tool: toolName, riskLevel: tool.riskLevel, args });

      // Dangerous tools require explicit user approval when REQUIRE_APPROVAL is enabled
      if (tool.riskLevel === 'dangerous' && config.REQUIRE_APPROVAL) {
        log.info('Awaiting approval', { tool: toolName });
        const approved = await onToolCall({ toolName, args, requiresApproval: true });
        if (!approved) {
          anyDenied = true;
          log.info('Tool denied by user', { tool: toolName });
          // Use a very explicit denial message so the LLM doesn't retry or simulate output
          const deniedResult = `The user explicitly denied running "${toolName}". Do NOT attempt this action again or simulate its output. Simply acknowledge that the action was cancelled.`;
          messages.push({ role: 'tool', content: deniedResult });
          onToolResult?.({ toolName, result: `"${toolName}" was denied by the user.` });
          continue;
        }
        log.info('Tool approved by user', { tool: toolName });
      } else {
        // Safe/moderate — signal without requiring approval (always returns true)
        await onToolCall({ toolName, args, requiresApproval: false });
      }

      // Execute the tool — always returns a string, never throws
      const toolStart = Date.now();
      let result;
      try {
        result = await tool.execute(args, undefined, { onToolResult });
      } catch (err) {
        result = `Tool execution error: ${err.message}`;
        log.error('Tool execution threw', { tool: toolName, error: err.message });
      }

      const toolMs = Date.now() - toolStart;
      log.info('Tool result', { tool: toolName, durationMs: toolMs, resultChars: String(result).length });
      log.debug('Tool result detail', { tool: toolName, result: String(result).slice(0, 300) });

      onToolResult?.({ toolName, result });

      // Append tool result in Ollama's expected format
      messages.push({ role: 'tool', content: String(result) });
    }

    // If any tool was denied, do one final LLM call WITHOUT tools so it can only
    // acknowledge the denial — it cannot retry or call tools again.
    if (anyDenied) {
      log.info('Denial finalisation call', { contextId });
      try {
        const finalResponse = await ollama.chat({
          model,
          messages,
          think: false,
          // No tools passed — forces a plain text response
        });
        const content = stripThinking(finalResponse.message.content || 'Action cancelled.');
        addMessage(contextId, { role: 'assistant', content });
        log.info('Task complete (denied)', { contextId, durationMs: Date.now() - taskStart });
        return content;
      } catch (err) {
        log.error('Denial finalisation LLM call failed', { error: err.message });
        const msg = 'Action was denied by the user.';
        addMessage(contextId, { role: 'assistant', content: msg });
        return msg;
      }
    }

    // Loop back — let the LLM process the tool results
  }

  // Exceeded max iterations
  log.warn('Max iterations reached', { contextId, maxIterations });
  const tooComplexMsg = `I reached the maximum number of steps (${maxIterations}) for this task. The task may be too complex or require manual intervention. Please try breaking it into smaller steps.`;
  addMessage(contextId, { role: 'assistant', content: tooComplexMsg });
  return tooComplexMsg;
}
