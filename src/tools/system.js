import os from 'os';

export const get_datetime = {
  name: 'get_datetime',
  description: 'Get the current date and time on the local machine as a human-readable string.',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    return new Date().toLocaleString('en-GB', { timeZoneName: 'short' });
  },
};

export const get_system_info = {
  name: 'get_system_info',
  description: 'Get information about the local system: OS platform, architecture, total and free memory, and Node.js version.',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    const toMB = bytes => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
    return [
      `Platform: ${os.platform()}`,
      `Architecture: ${os.arch()}`,
      `Total memory: ${toMB(os.totalmem())}`,
      `Free memory: ${toMB(os.freemem())}`,
      `Node.js: ${process.version}`,
      `Hostname: ${os.hostname()}`,
    ].join('\n');
  },
};
