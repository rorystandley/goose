import { execSync } from 'child_process';

export const run_command = {
  name: 'run_command',
  description: 'Execute a shell command on the local machine and return its output. Use this for running scripts, checking system state, managing files via CLI, or any terminal operation.',
  riskLevel: 'dangerous',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  },
  execute: async ({ command }) => {
    try {
      const output = execSync(command, {
        timeout: 30000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(Command ran successfully with no output)';
    } catch (err) {
      // execSync throws on non-zero exit; capture stdout+stderr from the error
      const stdout = err.stdout ? err.stdout.toString().trim() : '';
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      const parts = [];
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      if (!parts.length) parts.push(err.message);
      return `Command failed (exit ${err.status ?? 'unknown'}):\n${parts.join('\n')}`;
    }
  },
};
