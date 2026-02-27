import readline from 'readline';
import os from 'os';
import { runAgent } from '../../agent/loop.js';
import { clearHistory } from '../../agent/memory.js';
import { toolMap } from '../../tools/index.js';
import config from '../../config.js';
import { createLogger } from '../../logger.js';
import { startRecording, transcribe } from './stt.js';
import { speak } from './tts.js';

const log = createLogger('voice');

// Stable per-machine context ID so conversation memory persists across sessions
const VOICE_CONTEXT_ID = `voice-${os.hostname()}`;

// ---------------------------------------------------------------------------
// ANSI colour helpers — shared with CLI
// ---------------------------------------------------------------------------
const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  orange: '\x1b[38;5;208m',
};

// ---------------------------------------------------------------------------
// Wait for Enter — uses process.stdin directly in cooked (line-buffered) mode.
//
// readline.createInterface() puts stdin into raw mode, where input arrives
// character-by-character and rl.once('line') only fires while readline is
// actively expecting input. In cooked mode the terminal driver handles echo
// and line-buffering, so every Enter press reliably delivers a 'data' event.
// ---------------------------------------------------------------------------
function waitForEnter(prompt) {
  if (prompt) process.stdout.write(prompt);
  return new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
}

// ---------------------------------------------------------------------------
// Approval prompt — creates a short-lived readline interface just for the
// y/N question, then destroys it so stdin returns to cooked mode.
// ---------------------------------------------------------------------------
async function askApproval(toolName, args) {
  const argsStr = JSON.stringify(args, null, 2);
  console.log(`\n${c.red}🔴 Dangerous tool: ${c.bold}${toolName}${c.reset}`);
  console.log(`${c.dim}${argsStr}${c.reset}`);

  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${c.yellow}Approve? [y/N]: ${c.reset}`, answer => {
      rl.close();
      // Restore cooked mode after readline closes (readline sets raw mode on TTYs)
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.resume();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Callbacks — log tool calls to terminal, ask for dangerous tools
// ---------------------------------------------------------------------------
function makeCallbacks() {
  return {
    onToolCall: async ({ toolName, args, requiresApproval }) => {
      if (requiresApproval) return await askApproval(toolName, args);
      const risk      = toolMap[toolName]?.riskLevel;
      const riskColor = risk === 'moderate' ? c.yellow : c.green;
      console.log(`  ${riskColor}🔧 [${toolName}]${c.reset} ${c.dim}${JSON.stringify(args)}${c.reset}`);
      return true;
    },
    onToolResult: ({ result }) => {
      const preview = String(result).slice(0, 120).replace(/\n/g, ' ');
      const suffix  = String(result).length > 120 ? '…' : '';
      console.log(`  ${c.dim}↳ ${preview}${suffix}${c.reset}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Entry — called from src/voice.js
// ---------------------------------------------------------------------------
export async function runVoice() {
  // Cooked mode: terminal handles echo and line-buffering.
  // Each 'data' event = one complete line including the trailing \n.
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const line = '━'.repeat(45);
  console.log([
    '',
    `${c.orange}🪿 ${config.AGENT_NAME} — Voice Mode${c.reset}`,
    `${c.dim}${line}${c.reset}`,
    `${c.dim}Model   : ${config.OLLAMA_MODEL}`,
    `Context : ${VOICE_CONTEXT_ID}`,
    `Whisper : ${config.VOICE_WHISPER_MODEL}`,
    `Commands: "clear memory" · Ctrl+C to exit${c.reset}`,
    `${c.dim}"Talk to me, Goose."${c.reset}`,
    `${c.dim}${line}${c.reset}`,
    '',
  ].join('\n'));

  process.on('SIGINT', () => {
    process.stdin.pause();
    console.log(`\n${c.dim}Goodbye, Maverick.${c.reset}\n`);
    process.exit(0);
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await waitForEnter(`${c.orange}  Press Enter to start recording...${c.reset} `);

    let recording;
    try {
      recording = startRecording();
    } catch (err) {
      console.log(`\n  ${c.red}✗ ${err.message}${c.reset}\n`);
      continue;
    }

    console.log(`  ${c.red}●${c.reset} Recording — press Enter to stop`);
    await waitForEnter('');
    await recording.stop();

    process.stdout.write(`  ${c.dim}⏳ Transcribing...${c.reset} `);

    let task;
    try {
      task = await transcribe(recording.file);
    } catch (err) {
      console.log(`\n  ${c.red}✗ ${err.message}${c.reset}\n`);
      continue;
    }

    if (!task) {
      console.log(`${c.dim}(nothing heard, try again)${c.reset}\n`);
      continue;
    }

    console.log(`\n\n  ${c.bold}You:${c.reset}   ${task}\n`);

    // Handle "clear memory" spoken command
    if (/^clear\s+memory$/i.test(task)) {
      clearHistory(VOICE_CONTEXT_ID);
      const msg = 'Memory cleared.';
      console.log(`  ${c.dim}🧹 ${msg}${c.reset}\n`);
      await speak(msg);
      continue;
    }

    log.info('Voice task', { task: task.slice(0, 80), contextId: VOICE_CONTEXT_ID });

    let response;
    try {
      console.log(`  ${c.dim}⏳ Thinking...${c.reset}`);
      response = await runAgent(task, VOICE_CONTEXT_ID, makeCallbacks());
    } catch (err) {
      const msg = `Error: ${err.message}`;
      console.log(`\n  ${c.red}✗ ${msg}${c.reset}\n`);
      log.error('Voice task failed', { error: err.message });
      await speak('Sorry, something went wrong.');
      continue;
    }

    console.log(`\n  ${c.green}${c.bold}Goose:${c.reset} ${c.green}${response}${c.reset}\n`);
    await speak(response);
  }
}
