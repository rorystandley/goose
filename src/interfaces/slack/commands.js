import config from '../../config.js';
import { runAgent } from '../../agent/loop.js';
import { createApproval } from '../../agent/approvals.js';
import { buildHelpBlocks } from '../../tools/index.js';

/**
 * Register the /agent slash command handler.
 * @param {import('@slack/bolt').App} app
 */
export function registerCommandHandlers(app) {
  app.command('/agent', async ({ command, ack, client }) => {
    // Must ack within 3 seconds
    await ack();

    const task = command.text?.trim();

    // Help command — dynamically generated from the live tool registry
    if (!task || /^(help|tools|\?)$/i.test(task)) {
      await client.chat.postMessage({
        channel: command.channel_id,
        blocks: buildHelpBlocks(),
        text: 'Available tools', // fallback for notifications
      });
      return;
    }

    // Post initial "thinking" message and capture its ts for later update
    let thinkingTs;
    try {
      const thinking = await client.chat.postMessage({
        channel: command.channel_id,
        text: `🤔 *${config.AGENT_NAME} is working on:* ${task}`,
      });
      thinkingTs = thinking.ts;
    } catch (err) {
      console.error('Failed to post thinking message:', err.message);
    }

    const toolLog = [];

    try {
      const result = await runAgent(task, command.channel_id, {
        onToolCall: async ({ toolName, args, requiresApproval }) => {
          if (!requiresApproval) return true;

          // Post an approval request in thread
          const { id: approvalId, promise } = createApproval({ tool: toolName, args });

          await client.chat.postMessage({
            channel: command.channel_id,
            thread_ts: thinkingTs,
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

        onToolResult: ({ toolName, result }) => {
          toolLog.push(`🔧 \`${toolName}\` → ${String(result).slice(0, 200)}`);
        },
      });

      // Post the final answer in the thread
      await client.chat.postMessage({
        channel: command.channel_id,
        thread_ts: thinkingTs,
        text: result,
      });

      // Update the original thinking message to show completion
      if (thinkingTs) {
        await client.chat.update({
          channel: command.channel_id,
          ts: thinkingTs,
          text: `✅ *${config.AGENT_NAME} completed:* ${task}`,
        });
      }
    } catch (err) {
      console.error('Agent error:', err);
      await client.chat.postMessage({
        channel: command.channel_id,
        thread_ts: thinkingTs,
        text: `❌ *Error:* ${err.message}`,
      });
    }
  });
}
