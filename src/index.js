import config from './config.js';
import { app } from './interfaces/slack/bot.js';
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
    await app.start();
    log.info('Online — listening via Slack Socket Mode');
  } catch (err) {
    log.error('Failed to start', { error: err.message });
    process.exit(1);
  }
})();

// Graceful shutdown
async function shutdown(signal) {
  log.info('Shutting down', { signal });
  try {
    await app.stop();
    log.info('Goodbye');
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
