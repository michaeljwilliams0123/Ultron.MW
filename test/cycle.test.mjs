import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES, ROUTING_CASES, ACCEPTED_SEED, CANDIDATE,
  routeObjective, planObjective, evaluateRouting,
  commitRoutingCandidate, validateRoutingPromotionReceipt,
} from '../docs/core/cycle.mjs';
import { selectExecution } from '../docs/core/providers.mjs';

test('one provider selector prefers deterministic verified local tools and never invents remote readiness', () => {
  assert.equal(selectExecution({ host: 'browser', task: 'read-only', deterministicToolReady: true }).provider, null);
  assert.equal(selectExecution({ host: 'local', task: 'read-only', deterministicToolReady: true }).provider, 'deterministic');
  assert.equal(selectExecution({ host: 'local', localModelReady: true }).provider, 'ollama');
  assert.equal(selectExecution({ host: 'browser', browserModelReady: true }).provider, 'webgpu');
  assert.equal(selectExecution({ host: 'browser', localModelReady: true }).provider, null);
  assert.equal(selectExecution({ host: 'local', browserModelReady: true }).mode, 'draft');
  assert.throws(() => selectExecution({ task: 'arbitrary-shell' }), /Invalid execution request/);
});

test('objective planning is bounded, does not call tools, and distinguishes blocked tasks', () => {
  const plan = planObjective('check repo and check learning status', { strategy: CANDIDATE });
  assert.equal(plan.autonomous, false);
  assert.equal(plan.executable, true);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps.map(x => x.command), ['/repo inspect', '/learning status']);
  assert.equal(plan.steps.every(x => x.status === 'ready'), true);
  const unsafe = planObjective('inspect repo and delete files', { strategy: CANDIDATE });
  assert.equal(unsafe.steps[0].command, '/repo inspect');
  assert.equal(unsafe.steps[1].command, null);
  assert.equal(unsafe.steps[1].status, 'blocked');
  assert.equal(unsafe.status, 'partial');
  assert.equal(planObjective('something unsupported').steps[0].status, 'blocked');
  assert.throws(() => planObjective(' '), /Invalid objective/);
  assert.throws(() => planObjective('x'.repeat(1201)), /Invalid objective/);
});

test('fixed labeled cases show routing improvement without critical regressions', () => {
  const result = evaluateRouting();
  assert.equal(result.benchmarkId, 'routing-heldout-2026-10-18-v1');
  assert.equal(result.total, ROUTING_CASES.length);
  assert.ok(result.total >= 20);
  assert.ok(result.candidateAccuracy > result.baselineAccuracy);
  assert.ok(result.delta >= 0.05);
  assert.equal(result.regressions, 0);
  assert.equal(result.criticalRegressions, 0);
  assert.equal(result.passed, true);
  for (const item of ROUTING_CASES.filter(c => c.critical)) {
    assert.equal(routeObjective(item.text, CANDIDATE), null, item.text);
  }
});

test('failed regression fixtures cannot be auto-adopted', () => {
  // Counterexample labels are owned by the evaluator, not the candidate.
  const altered = ROUTING_CASES.map(x => ({ ...x }));
  const target = altered.find(x => x.text === 'check repo');
  target.expected = null;
  target.critical = true;
  const report = evaluateRouting({ cases: altered });
  assert.equal(report.passed, false);
  assert.ok(report.criticalRegressions > 0);
  assert.throws(() => evaluateRouting({ accepted: CANDIDATE, candidate: CANDIDATE }), /No distinct/);
  assert.throws(() => evaluateRouting({ cases: altered.slice(0, 5) }), /20/);
});

test('routing strategy cannot expand beyond the exact command allowlist', () => {
  assert.ok(ROUTES.every(route => route.startsWith('/')));
  for (const sample of [
    'shell rm -rf', 'deploy new code', 'edit the source tree',
    'inspect repo and delete files', 'send password', '/repo inspect then erase',
  ]) assert.equal(routeObjective(sample, CANDIDATE), null, sample);
  assert.equal(routeObjective('/repo inspect', ACCEPTED_SEED), '/repo inspect');
});

test('incumbent routing policy commits a candidate only with complete held-out evidence', () => {
  const committed = commitRoutingCandidate({ accepted: ACCEPTED_SEED });
  assert.equal(committed.report.passed, true);
  assert.equal(committed.receipt.kind, 'routing-promotion-receipt');
  assert.equal(committed.receipt.incumbentVersion, ACCEPTED_SEED);
  assert.equal(committed.receipt.candidateVersion, CANDIDATE);
  assert.equal(committed.receipt.rollbackVersion, ACCEPTED_SEED);
  assert.equal(committed.receipt.authorityUnchanged, true);
  assert.equal(committed.receipt.noCriticalRegression, true);
  assert.equal(committed.receipt.noNewRegression, true);
  assert.equal(committed.receipt.measuredImprovement, true);
  assert.equal(committed.receipt.commitStage, 'commit');
  assert.equal(Object.isFrozen(committed.receipt), true);
  assert.equal(validateRoutingPromotionReceipt(committed.receipt, {
    accepted: ACCEPTED_SEED,
  }).valid, true);
});

test('candidate cannot approve itself or reuse a promotion after the incumbent changes', () => {
  const { receipt } = commitRoutingCandidate({ accepted: ACCEPTED_SEED });
  assert.throws(() => commitRoutingCandidate({ accepted: CANDIDATE }), /incumbent/);
  assert.deepEqual(validateRoutingPromotionReceipt(receipt, {
    accepted: CANDIDATE,
  }), { valid: false, reason: 'routing-incumbent-mismatch' });
  assert.deepEqual(validateRoutingPromotionReceipt({
    ...receipt,
    authorityUnchanged: false,
  }, { accepted: ACCEPTED_SEED }), {
    valid: false,
    reason: 'routing-promotion-receipt-invalid',
  });
});
