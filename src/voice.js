import config from './config.js';
import { log } from './logger.js';
import { initTools } from './tools/index.js';
import { startMonitors } from './monitors/index.js';
import { runVoice } from './interfaces/voice/index.js';

log.info('Goose Voice starting', {
  agent:   config.AGENT_NAME,
  model:   config.OLLAMA_MODEL,
  whisper: config.VOICE_WHISPER_MODEL,
});

await initTools();
startMonitors();
runVoice();
