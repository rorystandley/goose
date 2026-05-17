import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// Use a real tmp file per suite to exercise the actual serialized write path.
const tmpManifest = path.join(os.tmpdir(), `goose-audio-test-${process.pid}.json`);

vi.mock('../../config.js', () => ({
  default: { AUDIO_PATH: tmpManifest },
}));

// Import after config mock so AUDIO_PATH is picked up at module load.
const { getAudio, getAudioById, addAudio, deleteAudio } = await import('../../audio/store.js');

beforeEach(() => {
  try { fs.unlinkSync(tmpManifest); } catch { /* not present */ }
});

describe('audio/store', () => {
  it('returns empty array when manifest does not exist', () => {
    expect(getAudio()).toEqual([]);
  });

  it('adds an entry and assigns an id + createdAt if missing', async () => {
    const entry = await addAudio({ path: '/tmp/fake.wav', text: 'hello' });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(entry.path).toBe('/tmp/fake.wav');
    expect(entry.source).toBe('ad-hoc');
    expect(entry.format).toBe('wav');
    const all = getAudio();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);
  });

  it('respects supplied id and metadata', async () => {
    const entry = await addAudio({
      id: 'fixed-id-1',
      path: '/tmp/a.wav',
      text: 'foo',
      source: 'mission',
      missionName: 'morning-briefing',
      contextId: 'mission-morning-briefing',
      model: 'kokoro',
      voice: 'af_heart',
      duration: 12.3,
    });
    expect(entry.id).toBe('fixed-id-1');
    expect(entry.source).toBe('mission');
    expect(entry.missionName).toBe('morning-briefing');
    expect(entry.duration).toBe(12.3);
  });

  it('getAudioById returns null for missing id', async () => {
    await addAudio({ path: '/tmp/a.wav', text: 'a' });
    expect(getAudioById('nope')).toBeNull();
  });

  it('deleteAudio removes the entry and returns it', async () => {
    const a = await addAudio({ path: '/tmp/a.wav', text: 'a' });
    const removed = await deleteAudio(a.id);
    expect(removed?.id).toBe(a.id);
    expect(getAudio()).toEqual([]);
  });

  it('deleteAudio returns null for missing id without throwing', async () => {
    await expect(deleteAudio('nope')).resolves.toBeNull();
  });

  it('serializes concurrent addAudio calls (no race / lost writes)', async () => {
    const N = 25;
    const promises = Array.from({ length: N }, (_, i) =>
      addAudio({ path: `/tmp/c${i}.wav`, text: `entry ${i}`, source: 'voice' }),
    );
    const entries = await Promise.all(promises);
    expect(entries).toHaveLength(N);
    const all = getAudio();
    expect(all).toHaveLength(N);
    // All ids unique
    expect(new Set(all.map(a => a.id)).size).toBe(N);
  });

  it('writes manifest atomically (file present after add)', async () => {
    await addAudio({ path: '/tmp/atomic.wav', text: 'hi' });
    expect(fs.existsSync(tmpManifest)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(tmpManifest, 'utf8'));
    expect(Array.isArray(parsed.audio)).toBe(true);
    expect(parsed.audio).toHaveLength(1);
  });

  it('survives malformed manifest (treats as empty)', async () => {
    await fsp.writeFile(tmpManifest, 'not valid json', 'utf8');
    expect(getAudio()).toEqual([]);
    // Subsequent add starts fresh
    const entry = await addAudio({ path: '/tmp/r.wav', text: 'recover' });
    expect(getAudio()).toEqual([expect.objectContaining({ id: entry.id })]);
  });
});
