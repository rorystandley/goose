import { readRun } from '../execution/store.js';
import { broadcast } from '../interfaces/web/sse.js';

const state = new Map();

function snapshot(name) {
  let entry = state.get(name);
  try {
    const run = readRun(`mission:${name}`);
    const observedAt = entry?.status === 'running' ? entry.startedAt : entry?.lastRun ?? entry?.startedAt ?? '';
    if (run && (!entry || (run.finishedAt ?? run.startedAt) > observedAt)) {
      entry = { status: run.status, startedAt: run.startedAt, lastRun: run.finishedAt ?? null,
        lastError: run.status === 'completed' ? null : run.outcome?.result ?? null,
        outcome: run.outcome, lastDuration: run.finishedAt ? new Date(run.finishedAt) - new Date(run.startedAt) : null };
    }
  } catch { /* The executor reports unreadable checkpoints on its next attempt. */ }
  if (!entry) return { name, status: 'idle', lastRun: null, lastError: null, lastDuration: null };
  return { name, ...entry };
}

export function recordMissionStart(name) {
  const previous = state.get(name) ?? {};
  state.set(name, {
    ...previous,
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  broadcast('missionStateChanged', snapshot(name));
}

export function recordMissionComplete(name, { durationMs, outcome } = {}) {
  const previous = state.get(name) ?? {};
  state.set(name, {
    ...previous,
    status: 'completed',
    outcome,
    lastRun: new Date().toISOString(),
    lastDuration: durationMs ?? null,
    lastError: null,
  });
  broadcast('missionStateChanged', snapshot(name));
}

export function recordMissionFailed(name, { error, durationMs, outcome } = {}) {
  const previous = state.get(name) ?? {};
  state.set(name, {
    ...previous,
    status: outcome?.status ?? 'failed',
    outcome,
    lastRun: new Date().toISOString(),
    lastDuration: durationMs ?? null,
    lastError: error ?? 'Unknown error',
  });
  broadcast('missionStateChanged', snapshot(name));
}

export function getMissionState(name) {
  return snapshot(name);
}

export function getAllMissionStates(missionNames = []) {
  const names = new Set([...state.keys(), ...missionNames]);
  return [...names].map(snapshot);
}

export function resetState() {
  state.clear();
}
