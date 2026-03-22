/**
 * Standalone scheduler process — runs missions independently of the Slack socket connection.
 * Notifies via the Slack Web API (REST), so Slack socket instability never blocks cron jobs.
 */
import pkg from '@slack/bolt';
const { App } = pkg;
import config from './config.js';
import { startScheduler } from './scheduler/index.js';
import { initTools } from './tools/index.js';
import { log } from './logger.js';

log.info('Scheduler process starting', { agent: config.AGENT_NAME });

// Create a bolt App without socket mode — gives us the web client for chat.postMessage only.
const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
});

(async () => {
  try {
    await initTools();

    await startScheduler(async (channel, missionName, result) => {
      await app.client.chat.postMessage({
        channel,
        text: `🪿 *Mission: ${missionName}*\n\n${result}`,
      });
    });

    log.info('Scheduler ready — waiting for cron triggers');
  } catch (err) {
    log.error('Scheduler failed to start', { error: err.message });
    process.exit(1);
  }
})();

process.on('SIGTERM', () => { log.info('Scheduler shutting down'); process.exit(0); });
process.on('SIGINT',  () => { log.info('Scheduler shutting down'); process.exit(0); });
