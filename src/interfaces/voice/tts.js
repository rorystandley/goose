import { spawn } from 'child_process';
import fetch from 'node-fetch';
import config from '../../config.js';
import { createLogger } from '../../logger.js';

const log = createLogger('voice:tts');

function processPromise(command, args, { swallowErrors = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    proc.on('close', (code, signal) => {
      if (code === 0 && signal == null) {
        resolve();
        return;
      }

      const reason = signal != null
        ? `terminated by signal ${signal}`
        : `exited with code ${code}`;
      const err = new Error(`${command} ${reason}`);

      if (swallowErrors) {
        log.warn('TTS unavailable', { command, error: err.message, code, signal });
        resolve();
      } else {
        reject(err);
      }
    });
    proc.on('error', err => {
      if (swallowErrors) {
        log.warn('TTS unavailable', { command, error: err.message });
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Speak text aloud using macOS `say`.
 * Resolves silently if `say` is unavailable (non-macOS or not in PATH).
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export function speakWithSay(text) {
  return processPromise('say', [text], { swallowErrors: true });
}

async function playAudio(audioPath) {
  await processPromise('afplay', [audioPath]);
}

/**
 * Speak text through a local MLX TTS Studio server.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakWithMlx(text) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.VOICE_MLX_TTS_TIMEOUT_MS,
  );

  try {
    const url = new URL('/synthesize', config.VOICE_MLX_TTS_URL).toString();
    const requestPayload = {
      text,
      model: config.VOICE_MLX_TTS_MODEL,
      voice: config.VOICE_MLX_TTS_VOICE,
      lang_code: config.VOICE_MLX_TTS_LANGUAGE,
      audio_format: 'wav',
    };
    if (config.VOICE_MLX_TTS_INSTRUCT?.trim()) {
      requestPayload.instruct = config.VOICE_MLX_TTS_INSTRUCT;
    }
    if (config.VOICE_MLX_TTS_TEMPERATURE != null) {
      requestPayload.temperature = config.VOICE_MLX_TTS_TEMPERATURE;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MLX TTS failed with ${response.status}: ${detail}`);
    }

    const payload = await response.json();
    if (!payload.audio_path) {
      throw new Error('MLX TTS response did not include audio_path');
    }

    await playAudio(payload.audio_path);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Speak text aloud. Uses MLX TTS Studio when configured, then falls back to
 * macOS `say` so voice mode still works if the local server is offline.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speak(text) {
  if ((config.VOICE_TTS_BACKEND || 'say').toLowerCase() === 'mlx') {
    try {
      await speakWithMlx(text);
      return;
    } catch (err) {
      log.warn('MLX TTS unavailable, falling back to say', { error: err.message });
    }
  }

  await speakWithSay(text);
}
