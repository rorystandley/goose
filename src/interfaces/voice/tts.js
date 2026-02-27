import { spawn } from 'child_process';
import { createLogger } from '../../logger.js';

const log = createLogger('voice:tts');

/**
 * Speak text aloud using macOS `say`.
 * Resolves silently if `say` is unavailable (non-macOS or not in PATH).
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export function speak(text) {
  return new Promise(resolve => {
    const proc = spawn('say', [text]);
    proc.on('close', () => resolve());
    proc.on('error', err => {
      log.warn('TTS unavailable', { error: err.message });
      resolve();
    });
  });
}
