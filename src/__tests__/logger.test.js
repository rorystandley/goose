import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Logger tests
//
// The logger captures `process.env.LOG_LEVEL` at module-load time, so we
// must use vi.resetModules() + dynamic import() to get a fresh instance for
// each level-filtering test.
// ---------------------------------------------------------------------------

describe('createLogger — basic output', () => {
  it('returns an object with debug/info/warn/error methods', async () => {
    const { createLogger } = await import('../logger.js');
    const log = createLogger('test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('exported root `log` is a logger with the same methods', async () => {
    const { log } = await import('../logger.js');
    expect(typeof log.info).toBe('function');
  });
});

describe('createLogger — writes to correct stream', () => {
  let stdoutSpy, stderrSpy;

  beforeEach(async () => {
    vi.resetModules();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes info to stdout', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.info('hello');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes error to stderr', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.error('boom');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('includes the namespace in the output', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('myns');
    log.info('test message');
    const output = stdoutSpy.mock.calls[0]?.[0] ?? '';
    expect(output).toContain('myns');
  });

  it('includes the log message in the output', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.info('special message text');
    const output = stdoutSpy.mock.calls[0]?.[0] ?? '';
    expect(output).toContain('special message text');
  });

  it('serialises the data object as JSON', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.info('msg', { key: 'value' });
    const output = stdoutSpy.mock.calls[0]?.[0] ?? '';
    expect(output).toContain('"key"');
    expect(output).toContain('"value"');
  });
});

describe('createLogger — level filtering', () => {
  let stdoutSpy, stderrSpy;

  beforeEach(() => {
    vi.resetModules();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it('suppresses debug messages when LOG_LEVEL=info', async () => {
    process.env.LOG_LEVEL = 'info';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.debug('should be hidden');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('shows info messages when LOG_LEVEL=info', async () => {
    process.env.LOG_LEVEL = 'info';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.info('should appear');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('suppresses info and debug when LOG_LEVEL=error', async () => {
    process.env.LOG_LEVEL = 'error';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.debug('hidden');
    log.info('hidden');
    log.warn('hidden');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows error messages when LOG_LEVEL=error', async () => {
    process.env.LOG_LEVEL = 'error';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.error('visible');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('shows all messages when LOG_LEVEL=debug', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { createLogger } = await import('../logger.js');
    const log = createLogger('ns');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const totalCalls = stdoutSpy.mock.calls.length + stderrSpy.mock.calls.length;
    expect(totalCalls).toBe(4);
  });
});
