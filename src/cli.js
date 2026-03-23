/**
 * Goose CLI — Local AI Wingman, no Slack required.
 *
 * Usage:
 *   npm run cli                                            → interactive REPL
 *   npm run cli -- "do the thing"                          → one-shot mode
 *   node src/cli.js "what time is it?"                     → one-shot mode
 *   node src/cli.js engage --mission "analyze the logs"    → engage mode (smart model, elevated iterations)
 */

import config from './config.js';
import { log } from './logger.js';
import { initTools } from './tools/index.js';
import { startMonitors } from './monitors/index.js';
import { startWebServer } from './interfaces/web/server.js';
import { runCLI, runEngage } from './interfaces/cli/index.js';

const subcommand = process.argv[2];
const isEngage = subcommand === 'engage';
const isRepl = !subcommand;

log.info('Goose CLI starting', {
  agent:  config.AGENT_NAME,
  model:  config.OLLAMA_MODEL,
  host:   config.OLLAMA_HOST,
  mode:   isEngage ? 'engage' : isRepl ? 'repl' : 'one-shot',
});

await initTools();

if (isEngage) {
  // Parse --mission flag
  const missionIdx = process.argv.indexOf('--mission');
  const mission = missionIdx !== -1 ? process.argv.slice(missionIdx + 1).join(' ') : null;
  if (!mission) {
    console.error('Usage: goose engage --mission "your mission here"');
    process.exit(1);
  }
  runEngage(mission);
} else {
  // Start proactive monitors only in interactive REPL mode — not in one-shot scripting
  if (isRepl) {
    startMonitors();
    await startWebServer();
  }
  runCLI();
}
