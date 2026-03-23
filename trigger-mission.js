/**
 * One-shot mission trigger for manual testing.
 * Usage: node trigger-mission.js <mission-name>
 * Example: node trigger-mission.js twitter-marketing
 */
import pkg from '@slack/bolt';
const { App } = pkg;
import fs from 'fs';
import path from 'path';
import config from './src/config.js';
import { initTools } from './src/tools/index.js';
import { loadMissions, makeSchedulerCallbacks, buildTask } from './src/scheduler/index.js';
import { runAgent } from './src/agent/loop.js';
import { log } from './src/logger.js';

const missionName = process.argv[2];

if (!missionName) {
  console.error('Usage: node trigger-mission.js <mission-name>');
  process.exit(1);
}

const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
});

(async () => {
  await initTools();

  const missions = loadMissions();
  const mission = missions.find(m => m.name === missionName);

  if (!mission) {
    console.error(`Mission "${missionName}" not found. Available:`, missions.map(m => m.name));
    process.exit(1);
  }

  const baseContextId = mission.contextId || `mission-${mission.name}`;
  const contextId = mission.freshContext
    ? `${baseContextId}-${Date.now()}`
    : baseContextId;

  console.log(`Firing mission: ${mission.name} (contextId: ${contextId})`);

  let result;
  if (mission.phases) {
    let previousResult = null;
    for (const phase of mission.phases) {
      let phaseTask = phase.task;
      if (phase.injectPreviousResult && previousResult) {
        phaseTask = `${phaseTask}\n\nContext from previous phase:\n${previousResult}`;
      }
      console.log(`\n--- Phase: ${phase.name} ---`);
      previousResult = await runAgent(phaseTask, contextId, {
        ...makeSchedulerCallbacks(mission.name, phase.allowDangerous ?? false),
        ...(phase.maxIterations ? { maxIterations: phase.maxIterations } : {}),
        ...(phase.maxToolCallsPerIteration ? { maxToolCallsPerIteration: phase.maxToolCallsPerIteration } : {}),
        ...(phase.noTools ? { subAgentTools: { toolMap: {}, toolDefinitions: [] } } : {}),
      });
      console.log(previousResult);
    }
    result = previousResult;
  } else {
    result = await runAgent(
      buildTask(mission),
      contextId,
      {
        ...makeSchedulerCallbacks(mission.name, mission.allowDangerous ?? false),
        ...(mission.maxIterations ? { maxIterations: mission.maxIterations } : {}),
        ...(mission.maxToolCallsPerIteration ? { maxToolCallsPerIteration: mission.maxToolCallsPerIteration } : {}),
      },
    );
  }

  console.log('\n--- RESULT ---\n', result, '\n--------------');

  if (mission.saveResponseTo) {
    try {
      const savePath = path.join(process.cwd(), mission.saveResponseTo);
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, result, 'utf8');
      console.log(`Response saved to: ${mission.saveResponseTo}`);
    } catch (err) {
      console.error(`Failed to save response: ${err.message}`);
    }
  }

  if (mission.slackChannel) {
    // Apply notifyFrom post-processor if configured.
    // notifyFrom is a relative file path; the mission/plugin writes whatever it
    // wants to notify to that file. Falls back to the raw result if unreadable.
    let notifyContent = result;
    if (mission.notifyFrom) {
      try {
        notifyContent = fs.readFileSync(path.join(process.cwd(), mission.notifyFrom), 'utf8').trim();
      } catch { /* fall back to raw result */ }
    }

    console.log('\n--- NOTIFY ---\n', notifyContent, '\n--------------');
    await app.client.chat.postMessage({
      channel: mission.slackChannel,
      text: `🪿 *Mission: ${mission.name}*\n\n${notifyContent}`,
    });
    console.log(`Posted to Slack channel: ${mission.slackChannel}`);
  }

  process.exit(0);
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
