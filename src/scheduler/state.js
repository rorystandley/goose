import { broadcast } from '../interfaces/web/sse.js';

const state = new Map();

function snapshot(name) {
  const entry = state.get(name);
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

export function recordMissionComplete(name, { durationMs } = {}) {
  const previous = state.get(name) ?? {};
  state.set(name, {
    ...previous,
    status: 'completed',
    lastRun: new Date().toISOString(),
    lastDuration: durationMs ?? null,
    lastError: null,
  });
  broadcast('missionStateChanged', snapshot(name));
}

export function recordMissionFailed(name, { error, durationMs } = {}) {
  const previous = state.get(name) ?? {};
  state.set(name, {
    ...previous,
    status: 'failed',
    lastRun: new Date().toISOString(),
    lastDuration: durationMs ?? null,
    lastError: error ?? 'Unknown error',
  });
  broadcast('missionStateChanged', snapshot(name));
}

export function getMissionState(name) {
  return snapshot(name);
}

export function getAllMissionStates() {
  const names = new Set(state.keys());
  return [...names].map(snapshot);
}

export function resetState() {
  state.clear();
}
