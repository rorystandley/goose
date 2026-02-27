import { spawn } from 'child_process';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import config from '../../config.js';
import { createLogger } from '../../logger.js';

const log = createLogger('voice:stt');

// Monotonic counter — ensures filenames are unique even for same-millisecond calls
let _recCounter = 0;

// ---------------------------------------------------------------------------
// Model path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the whisper-cpp model file.
 * Checks common install locations in order:
 *   1. Absolute path (if VOICE_WHISPER_MODEL is already a full path)
 *   2. ~/.cache/whisper/ggml-<name>.bin  (whisper-cpp default download location)
 *   3. /opt/homebrew/share/whisper-cpp/models/ggml-<name>.bin  (Apple Silicon Homebrew)
 *   4. /usr/local/share/whisper-cpp/models/ggml-<name>.bin     (Intel Homebrew)
 *
 * @returns {string} absolute path to model file
 * @throws {Error} with install instructions if no model file found
 */
export function resolveModel() {
  const name = config.VOICE_WHISPER_MODEL;

  if (name.startsWith('/')) {
    if (existsSync(name)) return name;
    throw new Error(`Whisper model not found at '${name}'`);
  }

  const candidates = [
    join(homedir(), '.cache', 'whisper', `ggml-${name}.bin`),
    `/opt/homebrew/share/whisper-cpp/models/ggml-${name}.bin`,
    `/usr/local/share/whisper-cpp/models/ggml-${name}.bin`,
  ];

  const found = candidates.find(p => existsSync(p));
  if (found) return found;

  throw new Error(
    `Whisper model '${name}' not found.\n` +
    `Download it with:\n` +
    `  mkdir -p ~/.cache/whisper && curl -L -o ~/.cache/whisper/ggml-${name}.bin \\\n` +
    `  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`
  );
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Start recording from the default microphone using sox.
 * Returns a handle with the output file path and a stop() function.
 *
 * Audio format: 16 kHz mono 16-bit signed PCM — optimal for Whisper.
 *
 * @returns {{ file: string, stop: () => Promise<void> }}
 */
export function startRecording() {
  const file = join(tmpdir(), `goose-voice-${Date.now()}-${++_recCounter}.wav`);

  const proc = spawn('sox', [
    '-d',                  // default input device (microphone)
    '-r', '16000',         // 16 kHz sample rate
    '-c', '1',             // mono
    '-e', 'signed-integer',
    '-b', '16',            // 16-bit depth
    file,
  ]);

  proc.on('error', err => {
    throw new Error(`sox not found: ${err.message}\nInstall with: brew install sox`);
  });

  const stop = () => new Promise(resolve => {
    proc.kill('SIGTERM');
    proc.on('close', resolve);
  });

  return { file, stop };
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribe a WAV file using the whisper-cpp binary.
 * Deletes the WAV file after transcription.
 *
 * @param {string} file - absolute path to the WAV file
 * @returns {Promise<string>} clean transcription text
 */
export async function transcribe(file) {
  const model = resolveModel();

  log.debug('Transcribing', { file, model });

  return new Promise((resolve, reject) => {
    const proc = spawn('whisper-cli', [
      '--model',     model,
      '--language',  'en',
      '--no-timestamps',
      file,
    ]);

    let stdout = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', () => {}); // suppress whisper-cpp progress output

    proc.on('close', async () => {
      await unlink(file).catch(() => {});

      // Strip any residual [HH:MM:SS.sss --> HH:MM:SS.sss] timestamp markers,
      // collapse whitespace, and trim.
      const text = stdout
        .replace(/\[[\d:.,\s>-]+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      log.debug('Transcription complete', { chars: text.length });
      resolve(text);
    });

    proc.on('error', err => {
      reject(new Error(
        `whisper-cli not found: ${err.message}\n` +
        `Install with: brew install whisper-cpp`
      ));
    });
  });
}
