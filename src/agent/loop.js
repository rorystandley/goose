import { Ollama } from 'ollama';
import config from '../config.js';
import { getHistory, addMessage } from './memory.js';
import { toolMap, getOllamaToolDefinitions } from '../tools/index.js';

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
Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
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

  // Build the message array: system prompt + conversation history + new user message
  const systemMessage = { role: 'system', content: buildSystemPrompt() };
  const userMessage = { role: 'user', content: task };

  // Persist the user message to memory
  addMessage(contextId, userMessage);

  // Working copy of messages for this run (system + history)
  const history = getHistory(contextId);
  const messages = [systemMessage, ...history];

  const toolDefinitions = getOllamaToolDefinitions();

  for (let iteration = 0; iteration < config.MAX_TOOL_ITERATIONS; iteration++) {
    let response;
    try {
      response = await ollama.chat({
        model: config.OLLAMA_MODEL,
        messages,
        tools: toolDefinitions,
      });
    } catch (err) {
      const errorMsg = `LLM error: ${err.message}`;
      addMessage(contextId, { role: 'assistant', content: errorMsg });
      return errorMsg;
    }

    const assistantMessage = response.message;

    // No tool calls — final answer
    if (!assistantMessage.tool_calls?.length) {
      const content = assistantMessage.content || '(No response)';
      addMessage(contextId, { role: 'assistant', content });
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
        const errorResult = `Error: unknown tool "${toolName}"`;
        messages.push({ role: 'tool', content: errorResult });
        onToolResult?.({ toolName, result: errorResult });
        continue;
      }

      // Dangerous tools require explicit user approval when REQUIRE_APPROVAL is enabled
      if (tool.riskLevel === 'dangerous' && config.REQUIRE_APPROVAL) {
        const approved = await onToolCall({ toolName, args, requiresApproval: true });
        if (!approved) {
          anyDenied = true;
          // Use a very explicit denial message so the LLM doesn't retry or simulate output
          const deniedResult = `The user explicitly denied running "${toolName}". Do NOT attempt this action again or simulate its output. Simply acknowledge that the action was cancelled.`;
          messages.push({ role: 'tool', content: deniedResult });
          onToolResult?.({ toolName, result: `"${toolName}" was denied by the user.` });
          continue;
        }
      } else {
        // Safe/moderate — signal without requiring approval (always returns true)
        await onToolCall({ toolName, args, requiresApproval: false });
      }

      // Execute the tool — always returns a string, never throws
      let result;
      try {
        result = await tool.execute(args);
      } catch (err) {
        result = `Tool execution error: ${err.message}`;
      }

      onToolResult?.({ toolName, result });

      // Append tool result in Ollama's expected format
      messages.push({ role: 'tool', content: String(result) });
    }

    // If any tool was denied, do one final LLM call WITHOUT tools so it can only
    // acknowledge the denial — it cannot retry or call tools again.
    if (anyDenied) {
      try {
        const finalResponse = await ollama.chat({
          model: config.OLLAMA_MODEL,
          messages,
          // No tools passed — forces a plain text response
        });
        const content = finalResponse.message.content || 'Action cancelled.';
        addMessage(contextId, { role: 'assistant', content });
        return content;
      } catch (err) {
        const msg = 'Action was denied by the user.';
        addMessage(contextId, { role: 'assistant', content: msg });
        return msg;
      }
    }

    // Loop back — let the LLM process the tool results
  }

  // Exceeded max iterations
  const tooComplexMsg = `I reached the maximum number of steps (${config.MAX_TOOL_ITERATIONS}) for this task. The task may be too complex or require manual intervention. Please try breaking it into smaller steps.`;
  addMessage(contextId, { role: 'assistant', content: tooComplexMsg });
  return tooComplexMsg;
}
