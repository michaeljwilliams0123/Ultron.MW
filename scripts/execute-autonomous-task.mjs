/**
 * Task 3: Headless sidecar dispatch into Task 4's autonomy graph.
 *
 * The CLI bypasses only the Control Center's response-mode default. It is not
 * an authorization path: enforceSignedApproval remains true, and the graph
 * must verify an actual owner grant before any mutation. No shell execution,
 * credentials or implicit GitHub writes occur here.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OBJECTIVE = 'Default autonomous infrastructure validation canary';
const MAX_OBJECTIVE_CHARS = 800;
const SUCCESS_STATUSES = new Set(['succeeded', 'verified', 'completed']);

async function invokeGraph(context) {
  let orchestrator;
  try {
    orchestrator = await import('../src/autonomy-orchestrator.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' &&
        String(error.message).includes('autonomy-orchestrator.mjs')) {
      throw new Error('headless-graph-unavailable');
    }
    throw error;
  }
  if (typeof orchestrator.runAutonomyGraph !== 'function') {
    throw new Error('headless-graph-unavailable');
  }
  return orchestrator.runAutonomyGraph(context);
}

export async function dispatchHeadlessTask(objectiveString, {
  runGraph = invokeGraph,
  now = Date.now,
  newId = randomUUID,
} = {}) {
  if (objectiveString !== undefined && objectiveString !== null &&
      typeof objectiveString !== 'string') {
    throw new Error('headless-objective-invalid');
  }
  const objective = (objectiveString ?? '').trim() || DEFAULT_OBJECTIVE;
  if (objective.length > MAX_OBJECTIVE_CHARS || /[\x00-\x1f\x7f]/.test(objective)) {
    throw new Error('headless-objective-invalid');
  }
  if (typeof runGraph !== 'function') {
    throw new Error('headless-graph-unavailable');
  }
  const timestamp = now();
  const suffix = newId();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(suffix)) {
    throw new Error('headless-dispatch-identity-invalid');
  }
  const context = Object.freeze({
    taskId: `canary-exec-${timestamp}-${suffix}`,
    objective,
    requiresResponse: true,
    enforceSignedApproval: true,
    targetBranch: `canary/autonomous-run-${timestamp}-${suffix}`,
  });
  return runGraph(context);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await dispatchHeadlessTask(process.argv[2]);
    console.log(JSON.stringify(result));
    if (!SUCCESS_STATUSES.has(result?.status) || result?.productionAccepted === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    const code = String(error?.message || '').startsWith('headless-')
      ? error.message : 'headless-execution-failed';
    console.error(code);
    process.exitCode = 1;
  }
}
