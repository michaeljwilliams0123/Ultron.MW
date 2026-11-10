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
const TASK = /^[a-z0-9][a-z0-9-]{7,79}$/;
const BRANCH = /^ultron\/canary-[a-z0-9][a-z0-9-]{2,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const GRAPH_KEYS = new Set(['runGraph','now','newId','prepareOnly']);
const PREPARE_KEYS = new Set([...GRAPH_KEYS,'taskId','targetBranch',
  'sourceSha','operationDigest','requiresResponse','enforceSignedApproval']);

function assertOptions(options,allowedKeys) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(options))) {
    throw Error('headless-preparation-invalid');
  }
  for (const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(options))) {
    if (!allowedKeys.has(key) || !Object.hasOwn(descriptor,'value')) {
      throw Error('headless-preparation-invalid');
    }
  }
}

async function invokeGraph(context) {
  const moduleUrl = new URL('../src/autonomy-orchestrator.mjs',import.meta.url);
  let orchestrator;
  try {
    orchestrator = await import(moduleUrl);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && error?.url === moduleUrl.href) {
      throw new Error('headless-graph-unavailable');
    }
    throw error;
  }
  if (typeof orchestrator.runAutonomyGraph !== 'function') {
    throw new Error('headless-graph-unavailable');
  }
  return orchestrator.runAutonomyGraph(context);
}

export async function dispatchHeadlessTask(objectiveString,options = {}) {
  // Reject accessors, unknown fields and accidental mixing of graph/prepare modes.
  assertOptions(options,PREPARE_KEYS);
  if (Object.getOwnPropertyDescriptor(options,'prepareOnly')?.value !== true) {
    assertOptions(options,GRAPH_KEYS);
  }
  const {runGraph = invokeGraph,now = Date.now,newId = randomUUID,
    prepareOnly = false} = options;
  if (typeof prepareOnly !== 'boolean') throw Error('headless-preparation-invalid');
  if (objectiveString !== undefined && objectiveString !== null &&
      typeof objectiveString !== 'string') {
    throw new Error('headless-objective-invalid');
  }
  const objective = (objectiveString ?? '').trim() || DEFAULT_OBJECTIVE;
  if (objective.length > MAX_OBJECTIVE_CHARS || /[\x00-\x1f\x7f]/.test(objective)) {
    throw new Error('headless-objective-invalid');
  }
  if (prepareOnly) {
    const {taskId,targetBranch,sourceSha,operationDigest,
      requiresResponse,enforceSignedApproval} = options;
    if (typeof taskId !== 'string' || !TASK.test(taskId) ||
        typeof targetBranch !== 'string' || !BRANCH.test(targetBranch) ||
        typeof sourceSha !== 'string' || !SHA.test(sourceSha) ||
        typeof operationDigest !== 'string' || !DIGEST.test(operationDigest) ||
        requiresResponse !== true || enforceSignedApproval !== true) {
      throw Error('headless-preparation-invalid');
    }
    // Preparation carries no authorization: Task 2 validates the signed grant
    // and Task 4 owns the reserved write and remote readback.
    return Object.freeze({stage:'prepared',taskId,targetBranch,sourceSha,
      operationDigest});
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

Object.defineProperty(dispatchHeadlessTask,'supportsPrepareOnly',{value:true});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await dispatchHeadlessTask(process.argv[2]);
    const accepted = SUCCESS_STATUSES.has(result?.status) &&
      result?.productionAccepted === true;
    const safeStatus = typeof result?.status === 'string' &&
      /^[a-z][a-z0-9_-]{0,63}$/.test(result.status) ? result.status : 'unverified';
    // Never serialize arbitrary graph results; they may contain scoped tokens.
    console.log(JSON.stringify({status:safeStatus,productionAccepted:accepted}));
    if (!accepted) process.exitCode = 1;
  } catch (error) {
    const allowedErrors = new Set(['headless-objective-invalid',
      'headless-preparation-invalid','headless-dispatch-identity-invalid',
      'headless-graph-unavailable']);
    const code = allowedErrors.has(error?.message) ?
      error.message : 'headless-execution-failed';
    console.error(code);
    process.exitCode = 1;
  }
}
