import readline from 'readline';
import os from 'os';
import { runAgent } from '../../agent/loop.js';
import { clearHistory } from '../../agent/memory.js';
import { toolMap } from '../../tools/index.js';
import config from '../../config.js';
import { createLogger } from '../../logger.js';

const log = createLogger('cli');

// Stable per-machine context ID so memory persists across CLI sessions
const CLI_CONTEXT_ID = `cli-${os.hostname()}`;

// ---------------------------------------------------------------------------
// ANSI colour helpers — no extra dependencies
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
// Banner — printed at REPL startup
// ---------------------------------------------------------------------------
export function banner() {
  const line = '━'.repeat(45);
  return [
    '',
    `${c.orange}🪿 ${config.AGENT_NAME} — Local AI Wingman${c.reset}`,
    `${c.dim}${line}${c.reset}`,
    `${c.dim}Model   : ${config.OLLAMA_MODEL}`,
    `Context : ${CLI_CONTEXT_ID}`,
    `Commands: exit · quit · clear memory${c.reset}`,
    `${c.dim}"Talk to me, Goose."${c.reset}`,
    `${c.dim}${line}${c.reset}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Approval prompt — asks the user in the terminal for dangerous tools
// ---------------------------------------------------------------------------
async function askApproval(toolName, args) {
  return new Promise((resolve) => {
    const argsStr = JSON.stringify(args, null, 2);
    console.log(`\n${c.red}🔴 Dangerous tool: ${c.bold}${toolName}${c.reset}`);
    console.log(`${c.dim}${argsStr}${c.reset}`);

    const approval = readline.createInterface({ input: process.stdin, output: process.stdout });
    approval.question(`${c.yellow}Approve? [y/N]: ${c.reset}`, (answer) => {
      approval.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Callbacks factory — wires CLI output to runAgent's lifecycle hooks
// ---------------------------------------------------------------------------
export function makeCallbacks() {
  return {
    onToolCall: async ({ toolName, args, requiresApproval }) => {
      if (requiresApproval) {
        return await askApproval(toolName, args);
      }
      // Safe / moderate — log and auto-approve
      const risk = toolMap[toolName]?.riskLevel;
      const riskColor = risk === 'moderate' ? c.yellow : c.green;
      console.log(`${riskColor}🔧 [${toolName}]${c.reset} ${c.dim}${JSON.stringify(args)}${c.reset}`);
      return true;
    },

    onToolResult: ({ toolName: _toolName, result }) => {
      const str     = String(result);
      const preview = str.slice(0, 120).replace(/\n/g, ' ');
      const suffix  = str.length > 120 ? '…' : '';
      console.log(`${c.dim}   ↳ ${preview}${suffix}${c.reset}`);
    },
  };
}

// ---------------------------------------------------------------------------
// One-shot mode — run a single task then exit
// ---------------------------------------------------------------------------
async function oneShot(task) {
  log.info('One-shot task', { task: task.slice(0, 80) });
  console.log(`\n${c.dim}⏳ Working...${c.reset}`);
  try {
    const result = await runAgent(task, CLI_CONTEXT_ID, makeCallbacks());
    console.log(`\n${c.green}${result}${c.reset}\n`);
  } catch (err) {
    console.error(`\n${c.red}Error: ${err.message}${c.reset}\n`);
    log.error('One-shot failed', { error: err.message });
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Interactive REPL mode — readline loop until exit/quit
// ---------------------------------------------------------------------------
async function repl() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `${c.orange}🪿 goose>${c.reset} `,
  });

  console.log(banner());
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    // Blank input — re-prompt silently
    if (!input) {
      rl.prompt();
      return;
    }

    // Exit commands
    if (input === 'exit' || input === 'quit') {
      console.log(`\n${c.dim}Goodbye, Maverick.${c.reset}\n`);
      process.exit(0);
    }

    // Clear memory command
    if (/^clear\s+memory$/i.test(input)) {
      clearHistory(CLI_CONTEXT_ID);
      console.log(`${c.dim}🧹 Memory cleared.${c.reset}`);
      rl.prompt();
      return;
    }

    // Run task
    rl.pause();
    console.log(`\n${c.dim}⏳ Thinking...${c.reset}`);
    log.info('REPL task', { task: input.slice(0, 80) });

    try {
      const result = await runAgent(input, CLI_CONTEXT_ID, makeCallbacks());
      console.log(`\n${c.green}${result}${c.reset}\n`);
    } catch (err) {
      console.error(`\n${c.red}Error: ${err.message}${c.reset}\n`);
      log.error('REPL task failed', { error: err.message });
    }

    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${c.dim}Goodbye, Maverick.${c.reset}\n`);
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entry — called from src/cli.js
// ---------------------------------------------------------------------------
export function runCLI() {
  const task = process.argv[2];
  if (task) {
    oneShot(task);
  } else {
    repl();
  }
}
