import config from './config.js';
import { app } from './interfaces/slack/bot.js';

console.log(`
  Agent name : ${config.AGENT_NAME}
  Model      : ${config.OLLAMA_MODEL}
  Ollama host: ${config.OLLAMA_HOST}
  Approval   : ${config.REQUIRE_APPROVAL ? 'required for dangerous tools' : 'disabled'}
`);

(async () => {
  try {
    await app.start();
    console.log(`✅ ${config.AGENT_NAME} is online and listening in Slack.`);
  } catch (err) {
    console.error('Failed to start the Slack app:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\nReceived ${signal} — shutting down ${config.AGENT_NAME}...`);
  try {
    await app.stop();
    console.log('Goodbye.');
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
