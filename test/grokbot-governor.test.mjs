import test from 'node:test';
import assert from 'node:assert/strict';

import { deliberatePlan } from '../src/grokbot-governor.mjs';

const readyPlan = {
  objective: 'inspect repo',
  strategy: 'routing-v2',
  status: 'ready',
  steps: [{ index: 0, command: '/repo inspect', kind: 'read-only', status: 'ready' }],
  executable: true,
  mode: 'read-only',
  autonomous: false,
};

test('GrokBot council produces a deterministic zero-credit proceed receipt', () => {
  const first = deliberatePlan(readyPlan, {
    evidenceCoverage: 0.95,
    calibratedConfidence: 0.85,
    knownUnknowns: [],
    materialConflictCount: 0,
    observedAt: '2026-10-19T19:00:00.000Z',
  });
  const second = deliberatePlan(readyPlan, {
    evidenceCoverage: 0.95,
    calibratedConfidence: 0.85,
    knownUnknowns: [],
    materialConflictCount: 0,
    observedAt: '2026-10-19T19:00:00.000Z',
  });
  assert.deepEqual(first, second);
  assert.equal(first.decision, 'proceed');
  assert.equal(first.authority.actionAuthority, 'unchanged');
  assert.equal(first.authority.executable, false);
  assert.equal(first.modelInvocations, 0);
  assert.equal(first.creditCost, 0);
  assert.equal(first.participants.length, 3);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
});

test('known unknowns, blocked steps and material dissent hold the whole plan', () => {
  const held = deliberatePlan({
    ...readyPlan,
    status: 'partial',
    steps: [...readyPlan.steps, {
      index: 1,
      command: null,
      kind: 'needs-capability',
      status: 'blocked',
      reason: 'No supported deterministic tool matches.',
    }],
  }, {
    evidenceCoverage: 0.8,
    calibratedConfidence: 0.9,
    knownUnknowns: ['missing-capability'],
    materialConflictCount: 1,
    observedAt: '2026-10-19T19:00:00.000Z',
  });
  assert.equal(held.decision, 'hold');
  assert.equal(held.metacognition.proceed, false);
  assert.ok(held.deliberation.materialDissent.length >= 1);
});

test('cognitive input cannot smuggle authority or unknown plan fields', () => {
  assert.throws(() => deliberatePlan({ ...readyPlan, privileges: ['admin'] }, {
    evidenceCoverage: 1,
    calibratedConfidence: 1,
    knownUnknowns: [],
    materialConflictCount: 0,
  }), error => error?.code === 'grokbot-plan-invalid');
});
