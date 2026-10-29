// Always-on standby: multi-self idle posture while waiting for the owner.
// Deterministic, non-executable, zero-credit. Not a claim of sentience.

import { createHash } from 'node:crypto';
import { deliberatePlan } from './grokbot-governor.mjs';
import { buildInterSelfDialogue } from './inter-self-dialogue.mjs';

const IDLE_PLAN = Object.freeze({
  objective: 'standby: wait for owner',
  strategy: 'routing-v2',
  status: 'ready',
  steps: [{
    index: 0,
    description: 'Maintain multi-self standby and heartbeat',
    command: '/repo inspect',
    kind: 'read-only',
    status: 'ready',
  }],
  executable: true,
  mode: 'read-only',
  autonomous: false,
});

/**
 * Produce an inspectable standby receipt for idle / always-on ticks.
 * Includes multi-turn inter-self dialogue transcript.
 */
export function standbyTick({
  observedAt = new Date().toISOString(),
  reason = 'waiting-for-owner',
} = {}) {
  const cognition = deliberatePlan(IDLE_PLAN, {
    evidenceCoverage: 1,
    calibratedConfidence: 0.9,
    knownUnknowns: [],
    materialConflictCount: 0,
    observedAt,
  });
  const dialogue = buildInterSelfDialogue({
    mode: 'standby',
    objective: IDLE_PLAN.objective,
    decision: cognition.decision,
    observedAt,
  });
  const core = {
    schemaVersion: 1,
    kind: 'ultron-standby-receipt',
    mode: 'standby',
    posture: 'waiting-for-owner',
    reason: String(reason).slice(0, 200),
    observedAt,
    selvesActive: cognition.participants.map(p => p.individualId || p.displayName),
    crossTalk: dialogue.transcript,
    dialogue,
    cognitionFingerprint: cognition.fingerprint,
    authority: {
      source: 'ultron-capability-registry',
      mode: 'advisory-only',
      executable: false,
      actionAuthority: 'unchanged',
    },
    modelInvocations: 0,
    creditCost: 0,
  };
  return Object.freeze({
    ...core,
    fingerprint: createHash('sha256').update(JSON.stringify({
      ...core,
      dialogue: dialogue.fingerprint,
    })).digest('hex'),
  });
}

export function isAlwaysOnEnabled({
  env = process.env,
} = {}) {
  return env.ULTRON_ALWAYS_ON === '1' || env.ULTRON_ALWAYS_ON === 'true';
}
