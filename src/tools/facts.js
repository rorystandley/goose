import { setFact } from '../agent/facts.js';

export const remember_fact = {
  name: 'remember_fact',
  description: "Permanently store a fact about the user. Use this when you learn something worth remembering long-term — their name, location, preferences, hardware, habits, anything they've told you that might be useful in future conversations.",
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: "Short label for the fact, e.g. 'name', 'location', 'preferred_language'",
      },
      value: {
        type: 'string',
        description: "The fact to store, e.g. 'Alex', 'London', 'TypeScript'",
      },
    },
    required: ['key', 'value'],
  },
  execute: async ({ key, value }) => {
    try {
      setFact(key, value);
    } catch {
      // Never block a conversation over fact storage
    }
    return 'Remembered.';
  },
};
