import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects — must exist before vi.mock() factories run
// ---------------------------------------------------------------------------

/** Mock readline interface returned by createInterface() */
const mockRl = vi.hoisted(() => ({
  prompt:   vi.fn(),
  pause:    vi.fn(),
  resume:   vi.fn(),
  close:    vi.fn(),
  on:       vi.fn(),
  question: vi.fn(),
}));

/** Separate readline interface used for the approval y/N prompt */
const mockApprovalRl = vi.hoisted(() => ({
  close:    vi.fn(),
  question: vi.fn(),
}));

const mockRunAgent    = vi.hoisted(() => vi.fn());
const mockClearHistory = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('readline', () => ({
  default: {
    createInterface: vi.fn(),
  },
}));

vi.mock('../../agent/loop.js', () => ({
  runAgent: mockRunAgent,
}));

vi.mock('../../agent/memory.js', () => ({
  clearHistory: mockClearHistory,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are declared
// ---------------------------------------------------------------------------
import readline from 'readline';
import os from 'os';
import { banner, makeCallbacks, runCLI } from '../../interfaces/cli/index.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let exitSpy;
let consoleSpy;
let consoleErrSpy;

beforeEach(() => {
  vi.clearAllMocks();

  // Prevent process.exit() from killing the test runner
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

  // Suppress console output in test runs
  consoleSpy    = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  // Default: createInterface returns the main mockRl
  readline.createInterface.mockReturnValue(mockRl);

  // Default: runAgent resolves with a simple string
  mockRunAgent.mockResolvedValue('Task complete.');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// banner()
// ---------------------------------------------------------------------------
describe('banner', () => {
  it('returns a non-empty string', () => {
    const result = banner();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains the agent name from config', () => {
    expect(banner()).toContain('TestGoose');
  });

  it('contains the model name from config', () => {
    expect(banner()).toContain('test-model');
  });

  it('contains the CLI context ID (cli-<hostname>)', () => {
    expect(banner()).toContain(`cli-${os.hostname()}`);
  });

  it('mentions the exit command', () => {
    expect(banner()).toContain('exit');
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — safe tool
// ---------------------------------------------------------------------------
describe('makeCallbacks — safe tool (onToolCall)', () => {
  it('returns true without prompting the user', async () => {
    const { onToolCall } = makeCallbacks();
    const result = await onToolCall({
      toolName: 'get_datetime',
      args: {},
      requiresApproval: false,
    });
    expect(result).toBe(true);
    // No readline interface should have been created for approval
    expect(readline.createInterface).not.toHaveBeenCalled();
  });

  it('logs the tool name to console', async () => {
    const { onToolCall } = makeCallbacks();
    await onToolCall({ toolName: 'get_datetime', args: {}, requiresApproval: false });
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('get_datetime');
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — onToolResult
// ---------------------------------------------------------------------------
describe('makeCallbacks — onToolResult', () => {
  it('logs a preview of the result', () => {
    const { onToolResult } = makeCallbacks();
    onToolResult({ toolName: 'get_datetime', result: 'Monday, 23 Feb 2026' });
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('Monday, 23 Feb 2026');
  });

  it('truncates results longer than 120 chars and appends "…"', () => {
    const { onToolResult } = makeCallbacks();
    const longResult = 'x'.repeat(200);
    onToolResult({ toolName: 'read_file', result: longResult });
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('…');
    // The preview itself should not contain more than 120 x's followed by ellipsis
    expect(output).not.toContain('x'.repeat(121));
  });

  it('does NOT append "…" for results ≤ 120 chars', () => {
    const { onToolResult } = makeCallbacks();
    onToolResult({ toolName: 'get_datetime', result: 'short result' });
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).not.toContain('…');
  });

  it('replaces newlines with spaces in the preview', () => {
    const { onToolResult } = makeCallbacks();
    onToolResult({ toolName: 'read_file', result: 'line one\nline two' });
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    // Newlines should not appear literally in the preview
    expect(output).not.toContain('\n');
    expect(output).toContain('line one');
    expect(output).toContain('line two');
  });
});

// ---------------------------------------------------------------------------
// makeCallbacks — dangerous tool approval
// ---------------------------------------------------------------------------
describe('makeCallbacks — dangerous tool approval', () => {
  /** Helper: set up mockApprovalRl to answer the y/N question with `answer` */
  function stubApproval(answer) {
    // First call to createInterface → mockRl (repl/oneshot)
    // Second call → mockApprovalRl (approval prompt)
    readline.createInterface
      .mockReturnValueOnce(mockRl)         // for repl/oneshot (if called)
      .mockReturnValueOnce(mockApprovalRl); // for askApproval

    mockApprovalRl.question.mockImplementation((_prompt, cb) => cb(answer));
  }

  it('creates a readline interface for the approval prompt', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('y'));

    const { onToolCall } = makeCallbacks();
    await onToolCall({ toolName: 'run_command', args: { command: 'ls' }, requiresApproval: true });

    expect(readline.createInterface).toHaveBeenCalled();
    expect(mockApprovalRl.question).toHaveBeenCalled();
  });

  it('resolves true when user answers "y"', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('y'));

    const { onToolCall } = makeCallbacks();
    const result = await onToolCall({
      toolName: 'run_command', args: {}, requiresApproval: true,
    });
    expect(result).toBe(true);
  });

  it('resolves true when user answers "Y" (case insensitive)', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('Y'));

    const { onToolCall } = makeCallbacks();
    const result = await onToolCall({
      toolName: 'run_command', args: {}, requiresApproval: true,
    });
    expect(result).toBe(true);
  });

  it('resolves false when user answers "n"', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('n'));

    const { onToolCall } = makeCallbacks();
    const result = await onToolCall({
      toolName: 'run_command', args: {}, requiresApproval: true,
    });
    expect(result).toBe(false);
  });

  it('resolves false when user presses Enter with no input (default deny)', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb(''));

    const { onToolCall } = makeCallbacks();
    const result = await onToolCall({
      toolName: 'run_command', args: {}, requiresApproval: true,
    });
    expect(result).toBe(false);
  });

  it('logs the tool name and args before prompting', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('n'));

    const { onToolCall } = makeCallbacks();
    await onToolCall({
      toolName: 'write_file',
      args: { path: '/tmp/test.txt', content: 'hello' },
      requiresApproval: true,
    });

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('write_file');
  });

  it('closes the approval readline interface after answering', async () => {
    readline.createInterface.mockReturnValue(mockApprovalRl);
    mockApprovalRl.question.mockImplementation((_p, cb) => cb('y'));

    const { onToolCall } = makeCallbacks();
    await onToolCall({ toolName: 'run_command', args: {}, requiresApproval: true });

    expect(mockApprovalRl.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runCLI — one-shot mode
// ---------------------------------------------------------------------------
describe('runCLI — one-shot mode', () => {
  beforeEach(() => {
    // Override process.argv to simulate one-shot invocation
    process.argv = ['node', 'src/cli.js', 'what is the time?'];
  });

  afterEach(() => {
    process.argv = ['node', 'src/cli.js'];
  });

  it('calls runAgent with the task from argv[2]', async () => {
    mockRunAgent.mockResolvedValue('It is 9am.');
    runCLI();
    await vi.waitFor(() => expect(mockRunAgent).toHaveBeenCalled());
    expect(mockRunAgent).toHaveBeenCalledWith(
      'what is the time?',
      `cli-${os.hostname()}`,
      expect.any(Object),
    );
  });

  it('calls process.exit(0) after the task completes', async () => {
    mockRunAgent.mockResolvedValue('Done.');
    runCLI();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it('logs the result to console', async () => {
    mockRunAgent.mockResolvedValue('The result is here.');
    runCLI();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('The result is here.');
  });

  it('calls process.exit(1) when runAgent throws', async () => {
    mockRunAgent.mockRejectedValue(new Error('LLM offline'));
    runCLI();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
  });
});

// ---------------------------------------------------------------------------
// runCLI — REPL mode (event simulation via captured handlers)
// ---------------------------------------------------------------------------
describe('runCLI — REPL mode', () => {
  let lineHandler;
  let closeHandler;

  beforeEach(async () => {
    // No argv[2] → REPL mode
    process.argv = ['node', 'src/cli.js'];

    // Capture handlers registered via rl.on()
    const handlers = {};
    mockRl.on.mockImplementation((event, handler) => {
      handlers[event] = handler;
    });

    readline.createInterface.mockReturnValue(mockRl);

    runCLI();

    // Give runCLI a microtask to register handlers
    await Promise.resolve();

    lineHandler  = handlers['line'];
    closeHandler = handlers['close'];
  });

  it('prints the banner on startup', () => {
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('TestGoose');
  });

  it('calls rl.prompt() on startup', () => {
    expect(mockRl.prompt).toHaveBeenCalled();
  });

  it('re-prompts on empty input without calling runAgent', async () => {
    await lineHandler('');
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();
  });

  it('re-prompts on whitespace-only input without calling runAgent', async () => {
    await lineHandler('   ');
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('"exit" calls process.exit(0)', async () => {
    await lineHandler('exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('"quit" calls process.exit(0)', async () => {
    await lineHandler('quit');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('"clear memory" calls clearHistory with the CLI context ID', async () => {
    await lineHandler('clear memory');
    expect(mockClearHistory).toHaveBeenCalledWith(`cli-${os.hostname()}`);
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('"CLEAR MEMORY" is matched case-insensitively', async () => {
    await lineHandler('CLEAR MEMORY');
    expect(mockClearHistory).toHaveBeenCalled();
  });

  it('"clear  memory" (extra space) still matches', async () => {
    await lineHandler('clear  memory');
    expect(mockClearHistory).toHaveBeenCalled();
  });

  it('"clear memory" re-prompts after clearing (does not exit)', async () => {
    await lineHandler('clear memory');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();
  });

  it('a normal task calls rl.pause() before runAgent', async () => {
    await lineHandler('list my downloads');
    expect(mockRl.pause).toHaveBeenCalled();
    expect(mockRunAgent).toHaveBeenCalled();
    // pause called before runAgent
    const pauseOrder   = mockRl.pause.mock.invocationCallOrder[0];
    const agentOrder   = mockRunAgent.mock.invocationCallOrder[0];
    expect(pauseOrder).toBeLessThan(agentOrder);
  });

  it('a normal task calls runAgent with task and CLI context ID', async () => {
    await lineHandler('list my downloads');
    expect(mockRunAgent).toHaveBeenCalledWith(
      'list my downloads',
      `cli-${os.hostname()}`,
      expect.any(Object),
    );
  });

  it('result is logged to console after runAgent resolves', async () => {
    mockRunAgent.mockResolvedValue('Here are your downloads.');
    await lineHandler('list my downloads');
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join(' ');
    expect(output).toContain('Here are your downloads.');
  });

  it('calls rl.resume() and rl.prompt() after task completes', async () => {
    await lineHandler('list my downloads');
    expect(mockRl.resume).toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();
  });

  it('does not crash when runAgent throws — logs error and re-prompts', async () => {
    mockRunAgent.mockRejectedValue(new Error('Ollama down'));
    await expect(lineHandler('bad task')).resolves.not.toThrow();
    expect(consoleErrSpy).toHaveBeenCalled();
    expect(mockRl.resume).toHaveBeenCalled();
    expect(mockRl.prompt).toHaveBeenCalled();
  });

  it('close event calls process.exit(0)', async () => {
    await closeHandler();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
