/**
 * Repair App admission policy, not a GitHub transport or permission grant.
 * Callers must supply authenticated installation-token readback, a durable
 * authorization/stop snapshot, and independently observed GitHub base/head
 * state before any external write. No model response can create those facts.
 */
const REPO = 'michaeljwilliams0123/Ultron.MW';
const REPOSITORY_ID = 1424939667;
const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^ultron\/repair-[a-z0-9][a-z0-9-]{2,63}$/;
const KEY = /^repair:[a-z0-9][a-z0-9-]{7,90}$/;
const PATH = /^(src|test)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
const PLAN_KEYS = new Set(['schema','owner','objective','repository',
  'baseSha','branch','allowedPaths','idempotencyKey','maxAttempts',
  'maxCostCents','expiresAt']);
const STEP_KEYS = new Set(['operation','repository','branch','baseSha',
  'path','idempotencyKey','attempt']);
const STEPS = new Set(['branch.create','branch.update','pr.create',
  'pr.update','pr.comment']);
const GRANTS = Object.freeze({metadata:'read',contents:'write',
  pull_requests:'write',checks:'read',issues:'write'});
const OPTIONAL_GRANTS = Object.freeze({actions:'read'});
const admissions = new WeakSet();

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return NaN;
  return Date.parse(value);
}
function stopped(controls) {
  return !controls || controls.paused !== false || controls.revoked !== false;
}
function cleanPath(path) {
  return typeof path === 'string' && PATH.test(path) &&
    !path.split('/').some(segment => segment === '.' || segment === '..') &&
    !path.includes('\\') && !path.includes('%') &&
    !path.includes('//');
}
function assertIdentity(evidence, now) {
  const valid = evidence && typeof evidence === 'object' &&
    evidence.source === 'github-installation-token-readback' &&
    evidence.verified === true && evidence.principal === 'repair-app' &&
    evidence.repository === REPO &&
    evidence.repositoryId === REPOSITORY_ID &&
    Number.isSafeInteger(evidence.installationId) && evidence.installationId > 0 &&
    typeof evidence.actorRef === 'string' &&
    /^github-app:[a-z0-9][a-z0-9-]{2,70}$/.test(evidence.actorRef) &&
    Number.isFinite(timestamp(evidence.expiresAt)) &&
    timestamp(evidence.expiresAt) > now &&
    evidence.permissions && typeof evidence.permissions === 'object' &&
    !Array.isArray(evidence.permissions) &&
    Object.entries(GRANTS).every(([key,right]) =>
      evidence.permissions[key] === right) &&
    Object.entries(evidence.permissions).every(([key,right]) =>
      GRANTS[key] === right || OPTIONAL_GRANTS[key] === right);
  if (!valid) throw Error('Repair App identity readback invalid');
}
function assertPlan(plan, now) {
  const expiry = timestamp(plan?.expiresAt);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
    Object.keys(plan).some(key => !PLAN_KEYS.has(key)) ||
    plan.schema !== 'ultron.repair.plan.v1' ||
    plan.owner !== 'michaeljwilliams0123' ||
    plan.repository !== REPO || !SHA.test(plan.baseSha || '') ||
    !BRANCH.test(plan.branch || '') ||
    typeof plan.objective !== 'string' ||
    plan.objective !== plan.objective.trim() ||
    plan.objective.length < 12 || plan.objective.length > 240 ||
    /[\x00-\x1f\x7f]/.test(plan.objective) ||
    !Array.isArray(plan.allowedPaths) ||
    plan.allowedPaths.length < 1 || plan.allowedPaths.length > 8 ||
    plan.allowedPaths.some(path => !cleanPath(path)) ||
    new Set(plan.allowedPaths).size !== plan.allowedPaths.length ||
    !KEY.test(plan.idempotencyKey || '') ||
    !Number.isSafeInteger(plan.maxAttempts) ||
    plan.maxAttempts < 1 || plan.maxAttempts > 3 ||
    plan.maxCostCents !== 0 || !Number.isFinite(expiry) ||
    expiry <= now || expiry > now + 24 * 60 * 60 * 1000)
    throw Error('Repair plan rejected');
}
/**
 * An in-process, frozen preflight decision. Admission must be regenerated
 * after restart from fresh trusted identity and authorization observations;
 * the WeakSet prevents callers from manufacturing or cloning a decision.
 */
export function admitRepairTask({plan,identityEvidence,controls,now} = {}) {
  const instant = timestamp(now);
  if (!Number.isFinite(instant) || stopped(controls))
    throw Error('Repair admission paused or revoked');
  assertPlan(plan, instant);
  assertIdentity(identityEvidence, instant);
  const identity = Object.freeze({
    principal:'repair-app',actorRef:identityEvidence.actorRef,
    installationId:identityEvidence.installationId,
    repositoryId:identityEvidence.repositoryId,
  });
  const admission = Object.freeze({
    schema:'ultron.repair.admission.v1',owner:plan.owner,
    objective:plan.objective,repository:REPO,baseSha:plan.baseSha,
    branch:plan.branch,allowedPaths:Object.freeze([...plan.allowedPaths]),
    idempotencyKey:plan.idempotencyKey,maxAttempts:plan.maxAttempts,
    maxCostCents:0,expiresAt:new Date(timestamp(plan.expiresAt)).toISOString(),
    identity,
  });
  admissions.add(admission);
  return admission;
}
/**
 * Fail-closed per-step policy preflight. Live dispatch still requires a
 * PostgreSQL attempt reservation, fresh installation evidence, exact-object
 * GitHub readback, and response-loss reconciliation in the execution layer.
 */
export function assertRepairStep(admission,step,{
  now,controls,identityEvidence,
} = {}) {
  const instant = timestamp(now);
  if (!admissions.has(admission) || !Number.isFinite(instant) ||
    stopped(controls) || instant >= timestamp(admission.expiresAt))
    throw Error('Repair step denied: admission stopped or expired');
  try {
    assertIdentity(identityEvidence, instant);
  } catch {
    throw Error('Repair step denied: identity readback invalid');
  }
  if (identityEvidence.installationId !== admission.identity.installationId ||
      identityEvidence.actorRef !== admission.identity.actorRef ||
      identityEvidence.repositoryId !== admission.identity.repositoryId)
    throw Error('Repair step denied: identity changed');
  if (!step || typeof step !== 'object' || Array.isArray(step) ||
      Object.keys(step).some(key => !STEP_KEYS.has(key)) ||
      !STEPS.has(step.operation) || step.repository !== admission.repository ||
      step.branch !== admission.branch || step.baseSha !== admission.baseSha ||
      step.idempotencyKey !== admission.idempotencyKey ||
      !Number.isSafeInteger(step.attempt) || step.attempt < 1 ||
      step.attempt > admission.maxAttempts ||
      (step.operation === 'branch.update'
        ? !admission.allowedPaths.includes(step.path)
        : step.path !== undefined))
    throw Error('Repair step denied: operation or scope mismatch');
  return Object.freeze({admitted:true,operation:step.operation,attempt:step.attempt});
}
