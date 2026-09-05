import fs from 'fs';
import config from '../config.js';
import { writeJsonFile } from '../execution/store.js';
import { validateCriteria } from '../execution/verify.js';

const KANBAN_PATH = config.KANBAN_PATH;

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(KANBAN_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { tasks: [] };
    throw err;
  }
}

function writeStore(store) {
  writeJsonFile(KANBAN_PATH, store);
}

export function getTasks() {
  return readStore().tasks;
}

export function getTask(id) {
  return readStore().tasks.find(t => t.id === id) ?? null;
}

export function createTask({ title, description = '', priority = 'medium', tags = [], allowDangerous = false, acceptance = [] }) {
  validateCriteria(acceptance);
  const store = readStore();
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    priority,
    status: 'backlog',
    tags,
    allowDangerous,
    acceptance,
    runId: null,
    outcome: null,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    startedAt:   null,
    completedAt: null,
    contextId:   null,
    result:      null,
  };
  store.tasks.push(task);
  writeStore(store);
  return task;
}

export function updateTask(id, patch) {
  if (patch.acceptance !== undefined) validateCriteria(patch.acceptance);
  const store = readStore();
  const idx = store.tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  store.tasks[idx] = { ...store.tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(store);
  return store.tasks[idx];
}

export function deleteTask(id) {
  const store = readStore();
  const before = store.tasks.length;
  store.tasks = store.tasks.filter(t => t.id !== id);
  if (store.tasks.length === before) return false;
  writeStore(store);
  return true;
}

export function getReadyTasks() {
  return getTasks()
    .filter(t => t.status === 'ready')
    .sort((a, b) => {
      const pd = (PRIORITY_RANK[b.priority] ?? 2) - (PRIORITY_RANK[a.priority] ?? 2);
      if (pd !== 0) return pd;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

export function getInProgressTasks() {
  return getTasks().filter(t => t.status === 'in-progress');
}
