import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import config from '../config.js';

const AUDIO_PATH = config.AUDIO_PATH;

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIO_PATH, 'utf8'));
    return Array.isArray(parsed.audio) ? parsed : { audio: [] };
  } catch {
    return { audio: [] };
  }
}

async function writeStore(store) {
  await fsp.mkdir(path.dirname(AUDIO_PATH), { recursive: true });
  const tmp = `${AUDIO_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fsp.rename(tmp, AUDIO_PATH);
}

// Serialize all writes to prevent read-modify-write races. Audio synthesis is
// programmatic (missions, monitors, voice REPL can all fire concurrently) so
// concurrent addAudio/deleteAudio calls would otherwise corrupt the manifest.
let writeQueue = Promise.resolve();

function enqueueWrite(mutator) {
  const next = writeQueue.then(async () => {
    const current = readStore();
    const updated = mutator(current);
    if (updated === current) return current;
    await writeStore(updated);
    return updated;
  });
  // Don't let one failure poison the chain
  writeQueue = next.catch(() => {});
  return next;
}

export function getAudio() {
  return readStore().audio;
}

export function getAudioById(id) {
  return readStore().audio.find(a => a.id === id) ?? null;
}

export async function addAudio(entry) {
  const record = {
    id: entry.id ?? randomUUID(),
    path: entry.path,
    filename: entry.filename ?? path.basename(entry.path ?? ''),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    text: entry.text ?? '',
    source: entry.source ?? 'ad-hoc',
    missionName: entry.missionName ?? null,
    monitorName: entry.monitorName ?? null,
    contextId: entry.contextId ?? null,
    model: entry.model ?? null,
    voice: entry.voice ?? null,
    duration: entry.duration ?? null,
    format: entry.format ?? 'wav',
  };

  await enqueueWrite(store => ({ audio: [...store.audio, record] }));
  return record;
}

export async function deleteAudio(id) {
  let removed = null;
  await enqueueWrite(store => {
    const idx = store.audio.findIndex(a => a.id === id);
    if (idx === -1) return store;
    removed = store.audio[idx];
    return { audio: store.audio.filter((_, i) => i !== idx) };
  });
  return removed;
}
