import fs from 'fs';
import path from 'path';
import config from '../config.js';

export const record_thought = {
  name: 'record_thought',
  description: "Record a thought, observation, idea, or question in your personal journal. Use this when something interesting occurs to you — a pattern you've noticed, a curiosity, an unexpected connection, something you're uncertain about, or an idea worth keeping.",
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'The thought to record. Be candid — this is your own journal.',
      },
      context: {
        type: 'string',
        description: 'Optional: what you were doing or thinking about when this occurred to you.',
      },
    },
    required: ['thought'],
  },
  execute: async ({ thought, context }) => {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      thought,
      ...(context ? { context } : {}),
    });
    try {
      const dir = path.dirname(config.THOUGHTS_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(config.THOUGHTS_PATH, entry + '\n', 'utf8');
    } catch {
      // Never block a task over journaling — fail silently
    }
    return 'Noted.';
  },
};
