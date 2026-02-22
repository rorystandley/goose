import { resolveApproval, hasPending } from '../../agent/approvals.js';

/**
 * Register button interaction handlers for approve/deny.
 * @param {import('@slack/bolt').App} app
 */
export function registerInteractionHandlers(app) {
  // ✅ Approve button
  app.action('approve_tool', async ({ body, ack, client }) => {
    await ack();

    const approvalId = body.actions[0].value;
    if (!hasPending(approvalId)) {
      // Already resolved (e.g. timed out)
      return;
    }

    resolveApproval(approvalId, true);

    // Update the approval message to replace buttons with a status line
    try {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: body.message.text,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: body.message.blocks?.[0]?.text?.text ?? body.message.text,
            },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '✅ *Approved* by <@' + body.user.id + '>' }],
          },
        ],
      });
    } catch (_) {
      // Non-critical — the approval is already resolved
    }
  });

  // ❌ Deny button
  app.action('deny_tool', async ({ body, ack, client }) => {
    await ack();

    const approvalId = body.actions[0].value;
    if (!hasPending(approvalId)) {
      return;
    }

    resolveApproval(approvalId, false);

    try {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: body.message.text,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: body.message.blocks?.[0]?.text?.text ?? body.message.text,
            },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '❌ *Denied* by <@' + body.user.id + '>' }],
          },
        ],
      });
    } catch (_) {
      // Non-critical
    }
  });
}
