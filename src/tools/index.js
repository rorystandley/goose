import { web_search, fetch_url } from './web.js';
import { read_file, write_file, list_directory } from './filesystem.js';
import { run_command } from './shell.js';
import { get_datetime, get_system_info } from './system.js';
import { record_thought } from './reflect.js';
import { remember_fact } from './facts.js';
import { delegate_task, parallel_delegate } from './agent.js';
import { loadPlugins } from '../plugins/index.js';

// Built-in tools — always available
const builtInTools = [
  web_search,
  fetch_url,
  read_file,
  write_file,
  list_directory,
  run_command,
  get_datetime,
  get_system_info,
  record_thought,
  remember_fact,
  delegate_task,
  parallel_delegate,
];

// Mutable registry — populated with built-ins immediately,
// extended with plugin tools after initTools() is called.
export let tools = [...builtInTools];
export let toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

/**
 * Load plugin tools and merge them into the registry.
 * Call once at startup before starting any interface.
 */
export async function initTools() {
  const pluginTools = await loadPlugins();
  tools = [...builtInTools, ...pluginTools];
  toolMap = Object.fromEntries(tools.map(t => [t.name, t]));
}

// Transform tools into the format Ollama expects for function calling
export function getOllamaToolDefinitions() {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// Risk level display helpers
const RISK_EMOJI = { safe: '🟢', moderate: '🟡', dangerous: '🔴' };
const RISK_LABEL = { safe: 'safe', moderate: 'moderate', dangerous: 'dangerous — requires approval' };

/**
 * Build Slack Block Kit blocks listing all registered tools.
 * Called by the /goose help command — always reflects the live tool registry.
 */
export function buildHelpBlocks() {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🪿 Goose — Available Tools' },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${tools.length} tools registered · Use \`/goose <task>\` to give Goose anything to do` }],
    },
    { type: 'divider' },
  ];

  for (const tool of tools) {
    const emoji = RISK_EMOJI[tool.riskLevel] ?? '⚪';
    const label = RISK_LABEL[tool.riskLevel] ?? tool.riskLevel;
    const params = Object.keys(tool.parameters?.properties ?? {});
    const paramStr = params.length ? `\`${params.join('`  `')}\`` : '_none_';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *\`${tool.name}\`* — ${label}\n${tool.description}\n*Params:* ${paramStr}`,
      },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '🟢 auto-executes  🟡 auto-executes + logs  🔴 pauses for your Approve/Deny',
    }],
  });

  return blocks;
}
