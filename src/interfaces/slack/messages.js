import config from '../../config.js';
import { runAgent } from '../../agent/loop.js';
import { createApproval } from '../../agent/approvals.js';
import { clearHistory } from '../../agent/memory.js';

/**
 * Register DM message handler.
 * @param {import('@slack/bolt').App} app
 */
export function registerMessageHandlers(app) {
  app.message(async ({ message, client }) => {
    // Only handle DMs
    if (message.channel_type !== 'im') return;

    // Ignore bot messages
    if (message.bot_id) return;

    // Ignore message edits/deletes
    if (message.subtype) return;

    const text = message.text?.trim();
    if (!text) return;

    // Special command: clear conversation memory
    if (/^clear\s+memory$/i.test(text)) {
      clearHistory(message.user);
      await client.chat.postMessage({
        channel: message.channel,
        text: `🧹 Memory cleared! I've forgotten our previous conversation.`,
      });
      return;
    }

    // Post a typing indicator
    let thinkingTs;
    try {
      const thinking = await client.chat.postMessage({
        channel: message.channel,
        text: `🤔 Thinking...`,
      });
      thinkingTs = thinking.ts;
    } catch (err) {
      console.error('Failed to post thinking message:', err.message);
    }

    try {
      const result = await runAgent(text, message.user, {
        onToolCall: async ({ toolName, args, requiresApproval }) => {
          if (!requiresApproval) return true;

          // Post approval request in the DM
          const { id: approvalId, promise } = createApproval({ tool: toolName, args });

          await client.chat.postMessage({
            channel: message.channel,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `⚠️ *${config.AGENT_NAME} wants to run \`${toolName}\`*\n\`\`\`${JSON.stringify(args, null, 2)}\`\`\``,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '✅ Approve' },
                    style: 'primary',
                    action_id: 'approve_tool',
                    value: approvalId,
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '❌ Deny' },
                    style: 'danger',
                    action_id: 'deny_tool',
                    value: approvalId,
                  },
                ],
              },
            ],
          });

          return promise;
        },

        onToolResult: () => {
          // No-op for DMs — keep the conversation clean
        },
      });

      // Delete the thinking message and post the real response
      if (thinkingTs) {
        try {
          await client.chat.delete({ channel: message.channel, ts: thinkingTs });
        } catch (_) {}
      }

      await client.chat.postMessage({
        channel: message.channel,
        text: result,
      });
    } catch (err) {
      console.error('Agent error (DM):', err);
      if (thinkingTs) {
        try {
          await client.chat.delete({ channel: message.channel, ts: thinkingTs });
        } catch (_) {}
      }
      await client.chat.postMessage({
        channel: message.channel,
        text: `❌ *Error:* ${err.message}`,
      });
    }
  });
}
