import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import config from '../config.js';

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function filename(id) {
  return path.join(config.RUNS_PATH, `${fingerprint(id)}.json`);
}
export function readRun(id) {
  try { return JSON.parse(fs.readFileSync(filename(id), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
export function writeRun(id, state) {
  writeJsonFile(filename(id), state);
}
export function writeJsonFile(target, state) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    const directory = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { fs.rmSync(temporary, { force: true }); }
}

// A PID lock coordinates scheduler and web processes sharing the same data dir.
// OS process liveness, not a timeout, determines whether a run can be recovered.
export function acquireRun(id) {
  const lock = `${filename(id)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const prepared = `${lock}.${token}.tmp`;
  fs.mkdirSync(prepared);
  fs.writeFileSync(path.join(prepared, 'owner.json'), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.renameSync(prepared, lock);
      } catch (err) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(err.code)) throw err;
        let owner;
        try { owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')); }
        catch { return null; } // Incomplete lock creation: fail closed.
        try { process.kill(owner.pid, 0); return null; }
        catch (err) { if (err.code !== 'ESRCH') return null; }
        // Claim stale-lock cleanup atomically before removing it.
        try { fs.mkdirSync(path.join(lock, 'reaping')); }
        catch { return null; }
        const current = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
        if (current.token !== owner.token || current.pid !== owner.pid) {
          fs.rmdirSync(path.join(lock, 'reaping'));
          return null;
        }
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      return () => fs.rmSync(lock, { recursive: true, force: true });
    }
    return null;
  } finally { fs.rmSync(prepared, { recursive: true, force: true }); }
}
