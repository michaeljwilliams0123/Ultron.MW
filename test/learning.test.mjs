import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningLoop } from '../src/learning.mjs';

test('observations deduplicate by receipt ID', () => {
  const l = new LearningLoop();
  const entry = { id: 'r-1', taskId: 'task', evidence: 'verified receipt', score: 0.8 };
  assert.equal(l.observe(entry).duplicate, false);
  assert.equal(l.observe(entry).duplicate, true);
  assert.equal(l.snapshot().observations.length, 1);
});
test('missing evidence and invalid scores are rejected', () => {
  const l = new LearningLoop();
  assert.throws(() => l.observe({ id: 'x', taskId: 'task', score: 2 }), /required/);
});
test('self-rating alone cannot promote', () => {
  const l = new LearningLoop();
  l.propose({ id: 'candidate-A', description: 'change search method', artifactHash: 'hash-A' });
  assert.throws(() => l.promote('candidate-A'), /not passed/);
  assert.throws(() => l.evaluate('candidate-A', { sampleSize: 1, baselineScore: 0.6, candidateScore: 1, criticalRegressions: 0, evaluatorId: 'self' }), /samples/);
});
test('critical regressions fail even with higher candidate score', () => {
  const l = new LearningLoop();
  l.propose({ id: 'candidate-A', description: 'change search method', artifactHash: 'hash-A' });
  assert.equal(l.evaluate('candidate-A', { sampleSize: 20, baselineScore: 0.6, candidateScore: 0.9, criticalRegressions: 1, evaluatorId: 'heldout-v1' }).passed, false);
  assert.throws(() => l.promote('candidate-A'), /not passed/);
});
test('validated improvement promotes, then rollback preserves history', () => {
  const l = new LearningLoop();
  l.propose({ id: 'candidate-A', description: 'change search method', artifactHash: 'hash-A' });
  assert.equal(l.evaluate('candidate-A', { sampleSize: 20, baselineScore: 0.6, candidateScore: 0.8, criticalRegressions: 0, evaluatorId: 'heldout-v1' }).passed, true);
  assert.equal(l.promote('candidate-A'), 'candidate-A');
  assert.equal(l.rollback('regression after canary'), 'seed-v1');
  assert.equal(l.snapshot().history.length, 2);
});
test('stale branch candidates cannot promote after another succeeds', () => {
  const l = new LearningLoop();
  for (const id of ['A', 'B']) {
    l.propose({ id, description: 'test', artifactHash: id });
    l.evaluate(id, { sampleSize: 10, baselineScore: 0.5, candidateScore: 0.6, criticalRegressions: 0, evaluatorId: 'heldout-v1' });
  }
  l.promote('A');
  assert.throws(() => l.promote('B'), /current accepted base/);
});
