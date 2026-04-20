import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const mockConfig    = vi.hoisted(() => ({
  VOICE_WHISPER_MODEL: 'base.en',
  VOICE_TTS_BACKEND: 'say',
  VOICE_MLX_TTS_URL: 'http://127.0.0.1:7860',
  VOICE_MLX_TTS_MODEL: 'test-tts-model',
  VOICE_MLX_TTS_VOICE: 'casual_male',
  VOICE_MLX_TTS_LANGUAGE: 'en',
  VOICE_MLX_TTS_TIMEOUT_MS: 5000,
}));
const mockSpawn     = vi.hoisted(() => vi.fn());
const mockFetch     = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockUnlink    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ---------------------------------------------------------------------------
// Module mocks — must be declared before static imports
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({ spawn: mockSpawn }));
vi.mock('node-fetch',    () => ({ default: mockFetch }));
vi.mock('fs',            () => ({ existsSync: mockExistsSync }));
vi.mock('fs/promises',   () => ({ unlink: mockUnlink }));

vi.mock('../../config.js', () => ({ default: mockConfig }));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Static imports — resolved after mocks are applied
// ---------------------------------------------------------------------------

import { speak }                               from '../../interfaces/voice/tts.js';
import { resolveModel, startRecording, transcribe } from '../../interfaces/voice/stt.js';

// ---------------------------------------------------------------------------
// Helper — create a mock child process with stdout/stderr EventEmitters
// ---------------------------------------------------------------------------

function makeMockProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill   = vi.fn(_signal => {
    setImmediate(() => proc.emit('close', 0));
  });
  return proc;
}

// ---------------------------------------------------------------------------
// TTS — speak()
// ---------------------------------------------------------------------------

describe('speak()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.VOICE_TTS_BACKEND = 'say';
    mockConfig.VOICE_MLX_TTS_URL = 'http://127.0.0.1:7860';
    mockConfig.VOICE_MLX_TTS_MODEL = 'test-tts-model';
    mockConfig.VOICE_MLX_TTS_VOICE = 'casual_male';
    mockConfig.VOICE_MLX_TTS_LANGUAGE = 'en';
    mockConfig.VOICE_MLX_TTS_TIMEOUT_MS = 5000;
  });

  it('spawns say with the provided text', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = speak('Hello Goose');
    // Emit 'close' after speak() has registered its listener (Promise ctor runs synchronously)
    proc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('say', ['Hello Goose']);
  });

  it('resolves without throwing when say is unavailable', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = speak('Hello');
    proc.emit('error', new Error('say not found'));

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves when say exits successfully', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = speak('Test message');
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('calls MLX TTS Studio and plays returned audio when configured', async () => {
    mockConfig.VOICE_TTS_BACKEND = 'mlx';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ audio_path: '/tmp/goose-tts.wav' }),
    });
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = speak('Hello Goose');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7860/synthesize',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(mockSpawn).toHaveBeenCalledWith('afplay', ['/tmp/goose-tts.wav']);
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalledWith('say', ['Hello Goose']);
  });

  it('falls back to say when afplay exits non-zero after MLX returns audio_path', async () => {
    mockConfig.VOICE_TTS_BACKEND = 'mlx';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ audio_path: '/tmp/goose-tts.wav' }),
    });
    const afplayProc = makeMockProc();
    const sayProc = makeMockProc();
    mockSpawn
      .mockReturnValueOnce(afplayProc)
      .mockReturnValueOnce(sayProc);

    const promise = speak('Fallback please');

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledWith('afplay', ['/tmp/goose-tts.wav']);
    });

    afplayProc.emit('close', 1);

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledWith('say', ['Fallback please']);
    });

    sayProc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });
  it('falls back to say when MLX TTS is unavailable', async () => {
    mockConfig.VOICE_TTS_BACKEND = 'mlx';
    mockFetch.mockRejectedValue(new Error('server offline'));
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = speak('Fallback please');

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledWith('say', ['Fallback please']);
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// STT — resolveModel()
// ---------------------------------------------------------------------------

describe('resolveModel()', () => {
  const HOMEBREW_PATH = '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.VOICE_WHISPER_MODEL = 'base.en';
  });

  it('finds model in Apple Silicon Homebrew prefix', () => {
    mockExistsSync.mockImplementation(p => p === HOMEBREW_PATH);
    expect(resolveModel()).toBe(HOMEBREW_PATH);
  });

  it('finds model in Intel Homebrew prefix', () => {
    const path = '/usr/local/share/whisper-cpp/models/ggml-base.en.bin';
    mockExistsSync.mockImplementation(p => p === path);
    expect(resolveModel()).toBe(path);
  });

  it('finds model in ~/.cache/whisper/', () => {
    const { homedir } = require('os');
    const path = `${homedir()}/.cache/whisper/ggml-base.en.bin`;
    mockExistsSync.mockImplementation(p => p === path);
    expect(resolveModel()).toBe(path);
  });

  it('returns an absolute path directly if it exists', () => {
    mockConfig.VOICE_WHISPER_MODEL = '/custom/path/model.bin';
    mockExistsSync.mockImplementation(p => p === '/custom/path/model.bin');
    expect(resolveModel()).toBe('/custom/path/model.bin');
  });

  it('throws a helpful error when no model file is found', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveModel()).toThrow('huggingface.co/ggerganov/whisper.cpp');
  });

  it('throws with install hint when absolute path does not exist', () => {
    mockConfig.VOICE_WHISPER_MODEL = '/missing/model.bin';
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveModel()).toThrow("not found at '/missing/model.bin'");
  });

  afterEach(() => {
    mockConfig.VOICE_WHISPER_MODEL = 'base.en';
  });
});

// ---------------------------------------------------------------------------
// STT — startRecording()
// ---------------------------------------------------------------------------

describe('startRecording()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure resolveModel doesn't throw during startRecording tests
    mockExistsSync.mockImplementation(p => p === HOMEBREW_PATH);
  });

  const HOMEBREW_PATH = '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin';

  it('spawns sox with the correct 16 kHz mono 16-bit arguments', () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const { file } = startRecording();

    expect(mockSpawn).toHaveBeenCalledWith('sox', expect.arrayContaining([
      '-d', '-r', '16000', '-c', '1', '-e', 'signed-integer', '-b', '16',
    ]));
    expect(file).toMatch(/goose-voice-\d+-\d+\.wav$/);
  });

  it('output file is in the system temp directory', () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);
    const { tmpdir } = require('os');
    const { file } = startRecording();
    expect(file).toContain(tmpdir());
  });

  it('stop() sends SIGTERM to the sox process and resolves when it closes', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const { stop } = startRecording();
    await stop();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('each call generates a unique filename', () => {
    const proc1 = makeMockProc();
    const proc2 = makeMockProc();
    mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

    const { file: f1 } = startRecording();
    const { file: f2 } = startRecording();
    expect(f1).not.toBe(f2);
  });
});

// ---------------------------------------------------------------------------
// STT — transcribe()
// ---------------------------------------------------------------------------

describe('transcribe()', () => {
  const HOMEBREW_PATH = '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.VOICE_WHISPER_MODEL = 'base.en';
    mockExistsSync.mockImplementation(p => p === HOMEBREW_PATH);
    // restoreMocks:true in vitest.config.js resets vi.fn() implementations to
    // return undefined — re-arm mockUnlink so unlink() returns a real Promise.
    mockUnlink.mockResolvedValue(undefined);
  });

  it('returns clean transcription text from whisper-cpp stdout', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/test.wav');
    proc.stdout.emit('data', ' Hello, this is a test.');
    proc.emit('close', 0);

    expect(await promise).toBe('Hello, this is a test.');
  });

  it('strips timestamp markers from whisper-cpp output', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/test.wav');
    proc.stdout.emit('data', '[00:00:00.000 --> 00:00:03.000]  What time is it in Tokyo?');
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toBe('What time is it in Tokyo?');
    expect(result).not.toContain('-->');
  });

  it('returns empty string for silent/empty recordings', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/test.wav');
    proc.emit('close', 0);

    expect(await promise).toBe('');
  });

  it('passes the correct flags to whisper-cli', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/audio.wav');
    proc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('whisper-cli', expect.arrayContaining([
      '--model', HOMEBREW_PATH,
      '--language', 'en',
      '--no-timestamps',
      '/tmp/audio.wav',
    ]));
  });

  it('rejects with a helpful message when whisper-cli is not found', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/test.wav');
    proc.emit('error', new Error('spawn whisper-cli ENOENT'));

    await expect(promise).rejects.toThrow('brew install whisper-cpp');
  });

  it('deletes the temp WAV file after transcription', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/cleanup-test.wav');
    proc.emit('close', 0);
    await promise;

    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cleanup-test.wav');
  });

  it('concatenates multiple stdout chunks before returning', async () => {
    const proc = makeMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = transcribe('/tmp/test.wav');
    proc.stdout.emit('data', 'Hello ');
    proc.stdout.emit('data', 'world.');
    proc.emit('close', 0);

    expect(await promise).toBe('Hello world.');
  });
});
