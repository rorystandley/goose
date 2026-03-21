/**
 * /goose status — builds a Block Kit snapshot of everything Goose is doing.
 *
 * Shows: uptime, Ollama connectivity, missions, monitors, memory contexts,
 * stored facts, and the latest thought entry.
 */
import fs from 'fs';
import config from '../../config.js';
import { getContextIds, getHistory } from '../../agent/memory.js';
import { getFacts } from '../../agent/facts.js';
import { listModels, getBackendName } from '../../agent/llm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readLastThought() {
  try {
    const lines = fs.readFileSync(config.THOUGHTS_PATH, 'utf8')
      .trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines.at(-1));
  } catch {
    return null;
  }
}

async function checkLLMBackend() {
  return listModels();
}

function formatUptime(seconds) {
  if (seconds < 60)   return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(isoTimestamp) {
  const mins = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 60_000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ---------------------------------------------------------------------------
// Block builder
// ---------------------------------------------------------------------------

export async function buildStatusBlocks() {
  // Fetch everything in parallel
  const [llmStatus, lastThought] = await Promise.all([
    checkLLMBackend(),
    Promise.resolve(readLastThought()),
  ]);

  const missions  = readJson(config.MISSIONS_PATH,  { missions:  [] }).missions;
  const monitors  = readJson(config.MONITORS_PATH,  { monitors:  [] }).monitors;
  const facts     = getFacts();   // plain object { key: value }
  const factsList = Object.entries(facts);

  const contextIds = getContextIds();
  const memContexts = contextIds.map(id => ({ id, count: getHistory(id).length }));

  const uptime = formatUptime(process.uptime());

  const blocks = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `🪿 ${config.AGENT_NAME} — Status` },
  });

  // ── Agent + Ollama ─────────────────────────────────────────────────────────
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Uptime*\n${uptime}` },
      { type: 'mrkdwn', text: `*Model*\n\`${config.OLLAMA_MODEL}\`` },
    ],
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: llmStatus.ok
        ? `✅ *${getBackendName()}* connected · ${llmStatus.models.length} model${llmStatus.models.length !== 1 ? 's' : ''} available`
        : `❌ *${getBackendName()}* unreachable at \`${config.LLM_BACKEND === 'vllm' ? config.VLLM_HOST : config.OLLAMA_HOST}\``,
    },
  });

  blocks.push({ type: 'divider' });

  // ── Missions ───────────────────────────────────────────────────────────────
  const activeMissions   = missions.filter(m => m.enabled);
  const inactiveMissions = missions.filter(m => !m.enabled);

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📅 Missions* — ${activeMissions.length} active${inactiveMissions.length ? `, ${inactiveMissions.length} disabled` : ''}`,
    },
  });

  if (missions.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No missions configured — add to data/missions.json_' }],
    });
  } else {
    for (const m of missions) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${m.enabled ? '🟢' : '⚫'} *${m.name}* · \`${m.cron}\`${m.timezone ? ` · ${m.timezone}` : ''}`,
        }],
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Monitors ───────────────────────────────────────────────────────────────
  const activeMonitors   = monitors.filter(m => m.enabled);
  const inactiveMonitors = monitors.filter(m => !m.enabled);

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*🔔 Monitors* — ${activeMonitors.length} active${inactiveMonitors.length ? `, ${inactiveMonitors.length} disabled` : ''}`,
    },
  });

  if (monitors.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No monitors configured — add to data/monitors.json_' }],
    });
  } else {
    for (const m of monitors) {
      const detail = m.type === 'url'    ? m.url
                   : m.type === 'system' ? `${m.metric} > ${m.threshold}%`
                   : m.type === 'file'   ? m.path
                   : m.type;
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${m.enabled ? '🟢' : '⚫'} *${m.name}* · ${m.type} · every ${m.interval}${detail ? ` · \`${detail}\`` : ''}`,
        }],
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Memory ─────────────────────────────────────────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*🧠 Memory* — ${memContexts.length} context${memContexts.length !== 1 ? 's' : ''}`,
    },
  });

  if (memContexts.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No conversations in memory yet_' }],
    });
  } else {
    // Group into chunks of 10 to stay within Slack's 10-element context limit
    for (let i = 0; i < memContexts.length; i += 8) {
      const chunk = memContexts.slice(i, i + 8);
      blocks.push({
        type: 'context',
        elements: chunk.map(c => ({
          type: 'mrkdwn',
          text: `\`${c.id}\` ${c.count} msg${c.count !== 1 ? 's' : ''}`,
        })),
      });
    }
  }

  // ── Facts ──────────────────────────────────────────────────────────────────
  if (factsList.length > 0) {
    blocks.push({ type: 'divider' });
    const preview = factsList
      .slice(-5)
      .map(([k, v]) => `• *${k}:* ${String(v).slice(0, 80)}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📌 Facts* — ${factsList.length} stored\n${preview}${factsList.length > 5 ? `\n_…and ${factsList.length - 5} more_` : ''}`,
      },
    });
  }

  // ── Latest thought ─────────────────────────────────────────────────────────
  if (lastThought) {
    blocks.push({ type: 'divider' });
    const ago = timeAgo(lastThought.timestamp);
    const preview = lastThought.thought.slice(0, 280);
    const truncated = lastThought.thought.length > 280;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*💭 Latest thought* — _${ago}_\n${preview}${truncated ? '…' : ''}`,
      },
    });
  }

  return blocks;
}
