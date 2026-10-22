import { createHash, randomUUID } from 'node:crypto';
import { normalizeComputerPlan } from './executor.mjs';

// Every new isolated Chrome profile starts at about:blank. Replaying a prior
// checkpoint's completed navigation steps by SKIPPING them leaves the fresh
// browser outside the origin allowlist. Instead, start a new objective identity
// only if nothing potentially mutating was completed or left pending.
// Preserve the prior checkpoint as evidence; never delete/reset it.
const PASSIVE = new Set(['navigate', 'observe', 'extract', 'wait']);
const VALID_ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;

export function restartSafeBrowserPlan(plan, checkpoint, {
  suffix = () => randomUUID().slice(0, 12),
} = {}) {
  if (!checkpoint) return Object.freeze({ plan, restarted: false });
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(plan)).digest('hex');
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
  const tail = suffix();
  if (!/^[a-z0-9]{8,16}$/i.test(tail))
    throw Error('Invalid browser session suffix');
  // Never silently reuse a persistent identifier across browser profiles.
  const root = plan.id.slice(0, 79 - tail.length - 1);
  const id = root + '.' + tail;
  if (!VALID_ID.test(id) || id === plan.id)
    throw Error('Invalid restarted browser objective identifier');
  return Object.freeze({
    plan: normalizeComputerPlan({ id, steps: plan.steps }, {
      allowedOrigins: plan.allowedOrigins,
    }),
    restarted: true,
    priorId: plan.id,
  });
}
