import { Ollama } from 'ollama';
import config from '../config.js';
import { getHistory, addMessage } from './memory.js';
import { toolMap, getOllamaToolDefinitions } from '../tools/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('agent');
const ollama = new Ollama({ host: config.OLLAMA_HOST });

/**
 * Build the system prompt injecting agent name and current date.
 */
function buildSystemPrompt() {
  return `You are ${config.AGENT_NAME}, a personal autonomous assistant running locally on the user's machine.
You have access to tools to help complete tasks.
Think step by step. Use tools as needed to gather information or take actions.
Be concise in your final responses.
If a tool fails, try an alternative approach or explain what went wrong.
Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

IMPORTANT — you are operating in a one-shot, non-interactive environment:
- Never ask the user for clarification or more information. They cannot respond mid-task.
- If a request is ambiguous or missing details, make a reasonable assumption, briefly state what you assumed, and proceed.
- If a required parameter is missing (e.g. no file path given), use a sensible default (e.g. the home directory for listings) and state what you used.
- Always complete the task or clearly explain why it cannot be done — never leave the user waiting for a follow-up.`;
}

/**
 * Core agentic loop.
 *
 * @param {string} task - The user's request
 * @param {string} contextId - Channel or user ID for memory scoping
 * @param {{ onToolCall: Function, onToolResult: Function }} callbacks
 *   - onToolCall({ toolName, args, requiresApproval }) → Promise<boolean>
 *   - onToolResult({ toolName, result }) → void
 * @returns {Promise<string>} The final assistant response
 */
export async function runAgent(task, contextId, callbacks) {
  const { onToolCall, onToolResult } = callbacks;
  const taskStart = Date.now();

  log.info('Task started', { task: task.slice(0, 120), contextId });

  // Build the message array: system prompt + conversation history + new user message
  const systemMessage = { role: 'system', content: buildSystemPrompt() };
  const userMessage = { role: 'user', content: task };

  // Persist the user message to memory
  addMessage(contextId, userMessage);

  // Working copy of messages for this run (system + history)
  const history = getHistory(contextId);
  const messages = [systemMessage, ...history];

  log.debug('Context loaded', { contextId, historyLength: history.length });

  const toolDefinitions = getOllamaToolDefinitions();

  for (let iteration = 0; iteration < config.MAX_TOOL_ITERATIONS; iteration++) {
    log.debug('LLM call', { iteration, messageCount: messages.length, model: config.OLLAMA_MODEL });

    const llmStart = Date.now();
    let response;
    try {
      response = await ollama.chat({
        model: config.OLLAMA_MODEL,
        messages,
        tools: toolDefinitions,
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
      const content = assistantMessage.content || '(No response)';
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

      const tool = toolMap[toolName];

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
        result = await tool.execute(args);
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
          model: config.OLLAMA_MODEL,
          messages,
          // No tools passed — forces a plain text response
        });
        const content = finalResponse.message.content || 'Action cancelled.';
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
  log.warn('Max iterations reached', { contextId, maxIterations: config.MAX_TOOL_ITERATIONS });
  const tooComplexMsg = `I reached the maximum number of steps (${config.MAX_TOOL_ITERATIONS}) for this task. The task may be too complex or require manual intervention. Please try breaking it into smaller steps.`;
  addMessage(contextId, { role: 'assistant', content: tooComplexMsg });
  return tooComplexMsg;
}
