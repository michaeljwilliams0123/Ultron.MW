import { createHash, randomUUID } from 'node:crypto';
import { normalizeComputerPlan } from './executor.mjs';

// Each new isolated Chrome profile starts at about:blank and never imports
// another profile's cookies. Previously completed passive navigation may be
// restarted, but an uncertain or previously interactive action never replays.
const PASSIVE = new Set(['navigate', 'observe', 'extract', 'wait']);
const VALID_ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const MAX_RESTARTS = 32;

function assertRestartable(plan, checkpoint) {
  const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  if (checkpoint.id !== plan.id || checkpoint.fingerprint !== fingerprint)
    throw Error('Existing browser checkpoint does not match the plan; reconcile');
  if (checkpoint.pending || checkpoint.status === 'reconcile-required')
    throw Error('Existing browser action may have executed; reconcile before a new session');
  if (!Array.isArray(checkpoint.completed) ||
      checkpoint.completed.length > plan.steps.length ||
      checkpoint.completed.some((id, i) => id !== plan.steps[i]?.id))
    throw Error('Invalid browser checkpoint; reconcile before a new session');
  if (checkpoint.completed.some(id =>
    !PASSIVE.has(plan.steps.find(step => step.id === id)?.action)))
    throw Error('Prior browser session includes interactive actions; reconcile before restart');
  if (!['running', 'approval-required', 'completed'].includes(checkpoint.status))
    throw Error('Invalid browser checkpoint state; reconcile');
}

function withId(plan, id) {
  return normalizeComputerPlan({ id, steps: plan.steps }, {
    allowedOrigins: plan.allowedOrigins,
  });
}

export function restartSafeBrowserPlan(plan, checkpoint, {
  suffix = () => randomUUID().replaceAll('-', '').slice(0, 16),
} = {}) {
  if (!checkpoint) return Object.freeze({ plan, restarted: false });
  assertRestartable(plan, checkpoint);
  const tail = suffix();
  if (!/^[a-z0-9]{8,16}$/i.test(tail))
    throw Error('Invalid browser session suffix');
  const root = plan.id.slice(0, 79 - tail.length - 1);
  const id = root + '.' + tail;
  if (!VALID_ID.test(id) || id === plan.id)
    throw Error('Invalid restarted browser objective identifier');
  return Object.freeze({
    plan: withId(plan, id),
    restarted: true,
    priorId: plan.id,
  });
}

/**
 * Choose a new browser objective under a persistent ROOT lock.
 *
 * The original checkpoint retains restartAttempts, linking every descendant.
 * No linked checkpoint may contain a completed interactive action or pending
 * dispatch. Repeated invocations can restart passive steps, but cannot erase
 * the existence of an earlier click, type, keypress or unverified write.
 *
 * Caller MUST hold store.withLock(rootPlan.id) through the entire browser
 * execution, including owner approval and manual MFA takeover.
 */
export async function selectSafeBrowserSession(rootPlan, store, options = {}) {
  if (!store || typeof store.read !== 'function' ||
      typeof store.write !== 'function' || typeof store.withLock !== 'function')
    throw Error('Safe browser restart requires durable locking and checkpoint storage');
  const checkpoint = await store.read(rootPlan.id);
  if (!checkpoint) return Object.freeze({ plan: rootPlan, restarted: false });

  assertRestartable(rootPlan, checkpoint);
  const attempts = checkpoint.restartAttempts ?? [];
  if (!Array.isArray(attempts) || attempts.length > MAX_RESTARTS ||
      new Set(attempts).size !== attempts.length ||
      attempts.some(id => typeof id !== 'string' || !VALID_ID.test(id) ||
        id === rootPlan.id))
    throw Error('Invalid browser restart lineage; reconcile before retry');

  for (let i = 0; i < attempts.length; i++) {
    const candidate = withId(rootPlan, attempts[i]);
    const previous = await store.read(candidate.id);
    if (!previous) {
      if (i !== attempts.length - 1)
        throw Error('Browser restart lineage has missing checkpoint; reconcile');
      // The owner process may have stopped after reserving this ID but
      // before launching Chrome. Reuse the same reserved ID rather than
      // generating another, preserving the original root-to-child mapping.
      return Object.freeze({
        plan: candidate, restarted: true, priorId: rootPlan.id, reserved: true,
      });
    }
    assertRestartable(candidate, previous);
  }

  if (attempts.length >= MAX_RESTARTS)
    throw Error('Too many browser restarts; reconcile prior attempts');
  for (let i = 0; i < 4; i++) {
    const selected = restartSafeBrowserPlan(rootPlan, checkpoint, options);
    if (attempts.includes(selected.plan.id) || await store.read(selected.plan.id))
      continue;
    // Persist the link BEFORE launching the child browser. If this write
    // fails the old plan stays untouched and no new action is dispatched.
    await store.write(rootPlan.id, {
      ...checkpoint, restartAttempts: [...attempts, selected.plan.id],
    });
    return selected;
  }
  throw Error('Unable to reserve a unique browser restart objective');
}
