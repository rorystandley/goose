import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock child_process (named export)
// ---------------------------------------------------------------------------
const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { run_command } from '../../tools/shell.js';

describe('run_command', () => {
  it('returns trimmed stdout on success', async () => {
    mockExecSync.mockReturnValueOnce('hello world\n');
    const result = await run_command.execute({ command: 'echo hello world' });
    expect(result).toBe('hello world');
  });

  it('returns placeholder when command succeeds with no output', async () => {
    mockExecSync.mockReturnValueOnce('');
    const result = await run_command.execute({ command: 'true' });
    expect(result).toBe('(Command ran successfully with no output)');
  });

  it('returns failure details when execSync throws (non-zero exit)', async () => {
    const err = Object.assign(new Error('Command failed'), {
      status: 1,
      stdout: Buffer.from('some stdout'),
      stderr: Buffer.from('some stderr'),
    });
    mockExecSync.mockImplementationOnce(() => { throw err; });

    const result = await run_command.execute({ command: 'false' });
    expect(result).toContain('Command failed');
    expect(result).toContain('some stdout');
    expect(result).toContain('some stderr');
    expect(result).toContain('exit 1');
  });

  it('falls back to error message when stdout/stderr are absent', async () => {
    const err = Object.assign(new Error('spawn failed'), { status: null });
    mockExecSync.mockImplementationOnce(() => { throw err; });

    const result = await run_command.execute({ command: 'bad' });
    expect(result).toContain('spawn failed');
  });

  it('calls execSync with a 30-second timeout', async () => {
    mockExecSync.mockReturnValueOnce('ok');
    await run_command.execute({ command: 'ls' });
    expect(mockExecSync).toHaveBeenCalledWith(
      'ls',
      expect.objectContaining({ timeout: 30000 })
    );
  });

  it('has riskLevel "dangerous"', () => {
    expect(run_command.riskLevel).toBe('dangerous');
  });
});
