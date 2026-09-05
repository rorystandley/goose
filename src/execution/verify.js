import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fingerprint } from './store.js';

function resolveFile(file) {
  return path.resolve(file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file);
}

/** A deliberately small, deterministic acceptance contract. No executable code. */
export function validateCriteria(criteria = []) {
  if (!Array.isArray(criteria)) throw new Error('acceptance must be an array');
  for (const c of criteria) {
    if (!c || c.type !== 'file' || typeof c.path !== 'string' || !c.path.trim()) {
      throw new Error('Each acceptance check must have type "file" and a path');
    }
    if (c.minBytes !== undefined && (!Number.isInteger(c.minBytes) || c.minBytes < 1)) {
      throw new Error('minBytes must be a positive integer');
    }
    if (c.maxAgeHours !== undefined && (!Number.isFinite(c.maxAgeHours) || c.maxAgeHours <= 0)) {
      throw new Error('maxAgeHours must be a positive number');
    }
    for (const key of ['contains', 'jsonKeys']) {
      if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].some(v => typeof v !== 'string'))) {
        throw new Error(`${key} must be an array of strings`);
      }
    }
    if (c.allowUnchanged !== undefined && typeof c.allowUnchanged !== 'boolean') {
      throw new Error('allowUnchanged must be a boolean');
    }
  }
}

export async function snapshotArtifacts(criteria = []) {
  validateCriteria(criteria);
  const snapshots = {};
  for (const c of criteria) {
    const file = resolveFile(c.path);
    try { snapshots[file] = fingerprint(await fs.readFile(file)); }
    catch (err) { if (err.code !== 'ENOENT') throw err; snapshots[file] = null; }
  }
  return snapshots;
}

export async function verifyArtifacts(criteria = [], baseline = {}) {
  validateCriteria(criteria);
  const evidence = [];
  for (const c of criteria) {
    const file = resolveFile(c.path);
    try {
      if (c.maxAgeHours !== undefined) {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs > c.maxAgeHours * 3600000) throw new Error(`File is older than ${c.maxAgeHours} hours`);
      }
      const content = await fs.readFile(file);
      if (content.length < (c.minBytes ?? 1)) throw new Error('File is empty or smaller than minBytes');
      const digest = fingerprint(content);
      if (!c.allowUnchanged && baseline[file] === digest) throw new Error('File is unchanged from before this run');
      const text = content.toString('utf8');
      for (const required of c.contains ?? []) {
        if (!text.includes(required)) throw new Error(`Missing required text: ${required}`);
      }
      if (c.jsonKeys) {
        const value = JSON.parse(text);
        for (const key of c.jsonKeys) {
          if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Missing JSON key: ${key}`);
        }
      }
      evidence.push({ path: file, passed: true, bytes: content.length, digest });
    } catch (err) { evidence.push({ path: file, passed: false, error: err.message }); }
  }
  return { verified: evidence.length > 0 && evidence.every(e => e.passed), evidence };
}
