import { isToolFailure } from './tool-result.js';
import { runAgent } from '../agent/loop.js';
import { acquireRun, fingerprint, readRun, writeRun } from './store.js';
import { snapshotArtifacts, validateCriteria, verifyArtifacts } from './verify.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const outcome = (status, result, extra = {}) => ({ status, result, verified: false, ...extra });

/**
 * Run/resume ordered stages under one process lock. Only transient inference
 * failures retry automatically. Completed tools and stages are never replayed.
 * restartCompleted starts a new scheduled occurrence after a terminal run.
 */
export async function executeWorkflow({ id, definition, stages, acceptance = [], inputs = [], restartCompleted = false, startNew = false,
  maxAttempts = 3, retryDelayMs = 1000 }) {
  const release = acquireRun(id);
  if (!release) return outcome('blocked', 'This run is already owned by another worker.', { reason: 'run_locked' });
  let state;
  try {
    validateCriteria(acceptance);
    validateCriteria(inputs);
    for (const stage of stages) validateCriteria(stage.acceptance);
    const signature = fingerprint(definition);
    state = readRun(id);
    if (startNew || (restartCompleted && state?.status === 'completed')) state = null;
    if (state && state.signature !== signature) {
      return outcome('blocked', 'The task changed since its checkpoint. Start a new run after reviewing previous actions.', { reason: 'definition_changed' });
    }
    if (state && state.status !== 'running') return state.outcome;
    if (!state) {
      state = { version: 1, signature, status: 'running', startedAt: new Date().toISOString(),
        stage: 0, results: [], checkpoint: null, attempts: 0,
        baseline: await snapshotArtifacts([...acceptance, ...stages.flatMap(s => s.acceptance ?? [])]) };
      writeRun(id, state);
    }
    const save = () => writeRun(id, state);
    const finish = result => {
      state.status = result.status;
      state.outcome = result;
      state.finishedAt = new Date().toISOString();
      save();
      return result;
    };
    if (state.stage === 0 && !state.checkpoint && inputs.length) {
      const check = await verifyArtifacts(inputs);
      if (!check.verified) return finish(outcome('blocked',
        `Required inputs are unavailable: ${check.evidence.filter(e => !e.passed).map(e => `${e.path}: ${e.error}`).join('; ')}`,
        { reason: 'input_verification_failed', evidence: check.evidence }));
    }
    for (; state.stage < stages.length;) {
      const stage = stages[state.stage];
      const task = typeof stage.task === 'function' ? stage.task(state.results.at(-1)?.result) : stage.task;
      let result;
      if (stage.direct) {
        if (state.checkpoint?.pendingTool) return finish(outcome('blocked', 'Direct tool outcome is unknown; review before restarting.', { reason: 'uncertain_tool_outcome' }));
        state.checkpoint = { pendingTool: { name: stage.name } };
        save();
        const value = await stage.direct();
        const failed = isToolFailure(value);
        result = outcome(failed ? 'failed' : 'completed', String(value), { reason: failed ? 'tool_error' : undefined });
      } else {
        const limit = Math.max(1, Math.min(5, Number.isInteger(maxAttempts) ? maxAttempts : 3));
        // A restart continues an in-flight attempt. Persisted attempt counts cap
        // retries across restarts as well as within this process.
        do {
          if (state.attempts >= limit) return finish(outcome('failed', 'Inference retry budget exhausted.', { reason: 'retry_limit' }));
          state.attempts++;
          save();
          const criteria = stage.acceptance ?? (state.stage === stages.length - 1 ? acceptance : []);
          result = await runAgent(criteria.length ? `${task}\n\nRequired output checks:\n${JSON.stringify(criteria)}` : task,
            stage.contextId, { ...stage.options, structured: true, checkpoint: state.checkpoint,
              onCheckpoint: checkpoint => { state.checkpoint = checkpoint; save(); } });
          if (!result || typeof result !== 'object' || !result.status) throw new Error('Agent returned an invalid structured outcome');
          if (!(result.status === 'failed' && result.retryable && state.attempts < limit)) break;
          await pause(Math.min(30000, Math.max(0, retryDelayMs) * 2 ** (state.attempts - 1)));
        } while (true);
      }
      const criteria = stage.acceptance ?? (state.stage === stages.length - 1 ? acceptance : []);
      if (criteria.length && (result.status === 'completed' || result.reason === 'tool_error')) {
        const check = await verifyArtifacts(criteria, state.baseline);
        result = { ...result, ...check, status: check.verified ? 'completed' : 'failed',
          reason: check.verified ? undefined : 'verification_failed',
          result: check.verified ? result.result : `Output checks failed: ${check.evidence.filter(e => !e.passed).map(e => `${e.path}: ${e.error}`).join('; ')}` };
      }
      if (result.status !== 'completed') return finish(result);
      if (stage.captureToolResults && result.toolResults?.length) {
        result = { ...result, result: result.toolResults.map(t => `--- ${t.toolName} ---\n${t.result}`).join('\n\n') };
      }
      state.results.push(result);
      state.stage++;
      state.checkpoint = null;
      state.attempts = 0;
      save();
    }
    let result = state.results.at(-1) ?? outcome('failed', 'Workflow has no stages.');
    if (acceptance.length) {
      const check = await verifyArtifacts(acceptance, state.baseline);
      result = { ...result, ...check, status: check.verified ? 'completed' : 'failed',
        reason: check.verified ? undefined : 'verification_failed',
        result: check.verified ? result.result : `Output checks failed: ${check.evidence.filter(e => !e.passed).map(e => `${e.path}: ${e.error}`).join('; ')}` };
    }
    return finish(result);
  } catch (err) {
    const result = outcome(state?.checkpoint?.pendingTool ? 'blocked' : 'failed', err.message,
      { reason: state?.checkpoint?.pendingTool ? 'uncertain_tool_outcome' : 'execution_error' });
    // Keep a pending-action marker if persistence itself failed.
    if (state) {
      state.status = result.status; state.outcome = result;
      try { writeRun(id, state); } catch { /* Last durable checkpoint remains authoritative. */ }
    }
    return result;
  } finally { release(); }
}
