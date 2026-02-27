import config from './config.js';
import { app } from './interfaces/slack/bot.js';
import { startMonitors } from './monitors/index.js';
import { startWebServer, stopWebServer } from './interfaces/web/server.js';
import { initTools } from './tools/index.js';
import { log } from './logger.js';

log.info('Starting', {
  agent: config.AGENT_NAME,
  model: config.OLLAMA_MODEL,
  ollamaHost: config.OLLAMA_HOST,
  approval: config.REQUIRE_APPROVAL ? 'required for dangerous tools' : 'disabled',
  logLevel: process.env.LOG_LEVEL ?? 'info',
});

(async () => {
  try {
    await initTools();
    await app.start();
    log.info('Online — listening via Slack Socket Mode');

    // Start proactive monitors (no-op if data/monitors.json doesn't exist)
    startMonitors(async (channel, monitorName, result) => {
      await app.client.chat.postMessage({
        token: config.SLACK_BOT_TOKEN,
        channel,
        text: `🔔 *Monitor: ${monitorName}*\n\n${result}`,
      });
    });

    // Start web UI dashboard (no-op if WEB_ENABLED is not set)
    await startWebServer();
  } catch (err) {
    log.error('Failed to start', { error: err.message });
    process.exit(1);
  }
})();

// Graceful shutdown
async function shutdown(signal) {
  log.info('Shutting down', { signal });
  try {
    await stopWebServer();
    await app.stop();
    log.info('Goodbye');
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled exceptions (e.g. @slack/socket-mode 'server explicit disconnect' bug)
// and exit cleanly so pm2 / any supervisor can restart the process automatically.
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — exiting for restart', { error: err.message });
  process.exit(1);
});
