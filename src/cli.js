/**
 * Goose CLI — Local AI Wingman, no Slack required.
 *
 * Usage:
 *   npm run cli                        → interactive REPL
 *   npm run cli -- "do the thing"      → one-shot mode
 *   node src/cli.js "what time is it?" → one-shot mode
 */

import config from './config.js';
import { log } from './logger.js';
import { initTools } from './tools/index.js';
import { startMonitors } from './monitors/index.js';
import { startWebServer } from './interfaces/web/server.js';
import { runCLI } from './interfaces/cli/index.js';

const isRepl = !process.argv[2];

log.info('Goose CLI starting', {
  agent:  config.AGENT_NAME,
  model:  config.OLLAMA_MODEL,
  host:   config.OLLAMA_HOST,
  mode:   isRepl ? 'repl' : 'one-shot',
});

await initTools();

// Start proactive monitors only in interactive REPL mode — not in one-shot scripting
if (isRepl) {
  startMonitors();
  await startWebServer();
}

runCLI();
