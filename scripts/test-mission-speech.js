#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log(`Usage:
  node scripts/test-mission-speech.js [mission-name] [text...]
  node scripts/test-mission-speech.js [mission-name] --failure [text...]

Examples:
  node scripts/test-mission-speech.js morning-briefing
  node scripts/test-mission-speech.js morning-briefing "Good morning. Mission speech is working."
  node scripts/test-mission-speech.js data-backup --failure`);
}

function loadMission(missionName) {
  const missionsPath = path.join(process.cwd(), 'data', 'missions.json');
  const parsed = JSON.parse(fs.readFileSync(missionsPath, 'utf8'));
  return parsed.missions?.find(mission => mission.name === missionName);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

const missionName = args[0] && !args[0].startsWith('--')
  ? args[0]
  : 'morning-briefing';
const isFailure = args.includes('--failure');
const textParts = args
  .slice(missionName === args[0] ? 1 : 0)
  .filter(arg => arg !== '--failure');

const mission = loadMission(missionName);
if (!mission) {
  console.error(`Mission not found: ${missionName}`);
  process.exit(1);
}

if (!isFailure && !mission.speakResponse) {
  console.warn(`Mission "${missionName}" does not have speakResponse enabled; testing the voice adapter anyway.`);
}
if (isFailure && !mission.speakOnFailure) {
  console.warn(`Mission "${missionName}" does not have speakOnFailure enabled; testing the failure voice path anyway.`);
}

const defaultText = isFailure
  ? `Goose mission ${missionName} failed: simulated failure speech test.`
  : `Goose mission ${missionName} speech test.`;
const text = textParts.join(' ').trim() || defaultText;

console.log(`Speaking mission speech test for "${missionName}" through the configured voice adapter.`);
const { speak } = await import('../src/interfaces/voice/tts.js');
await speak(text);
console.log('Mission speech test complete.');
