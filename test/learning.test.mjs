import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningLoop } from '../src/learning.mjs';

const cases = Array.from({ length: 12 }, (_, i) => ({ id: 'case-' + i }));
const run = async ({ version }) => ({
  score: version === 'seed-v1' ? 0.50 : 0.65,
  criticalRegression: false,
});

test('observation receipts deduplicate and require valid evidence', () => {
  const l = new LearningLoop();
  assert.equal(l.observe({ id: 'r1', taskId: 't1', score: 0.8, evidence: 'observed success' }).duplicate, false);
  assert.equal(l.observe({ id: 'r1', taskId: 't1', score: 0.8, evidence: 'observed success' }).duplicate, true);
  assert.equal(l.observations.size, 1);
  assert.throws(() => l.observe({ id: 'r2', taskId: 't1', score: 2, evidence: 'x' }), /required/);
});

test('candidate cannot self-promote or pass claimed scores without runnable cases', async () => {
  const l = new LearningLoop();
  l.propose({ id: 'a', description: 'candidate', artifactHash: 'hash' });
  assert.throws(() => l.promote('a'), /not passed/);
  await assert.rejects(() => l.evaluate('a', { sampleSize: 99, baselineScore: 0, candidateScore: 1 }), /runner/);
  assert.throws(() => l.promote('a'), /not passed/);
});

test('bad candidate is rejected when benchmark runner reports critical regressions', async () => {
  const l = new LearningLoop();
  l.propose({ id: 'a', description: 'candidate', artifactHash: 'hash' });
  const result = await l.evaluate('a', {
    cases, run: async ({ version }) => ({
      score: version === 'seed-v1' ? 0.3 : 0.8,
      criticalRegression: version === 'a',
    }),
  });
  assert.equal(result.passed, false);
  assert.equal(result.criticalRegressions, cases.length);
  assert.throws(() => l.promote('a'), /not passed/);
});

test('accepted measurable improvement rolls back with history', async () => {
  const l = new LearningLoop();
  l.propose({ id: 'a', description: 'candidate', artifactHash: 'hash' });
  assert.equal((await l.evaluate('a', { cases, run })).passed, true);
  assert.equal(l.promote('a'), 'a');
  assert.equal(l.rollback('canary regression'), 'seed-v1');
  assert.equal(l.history.length, 2);
});

test('stale validated candidate cannot override a newer accepted release', async () => {
  const l = new LearningLoop();
  l.propose({ id: 'a', description: 'candidate A', artifactHash: 'a' });
  l.propose({ id: 'b', description: 'candidate B', artifactHash: 'b' });
  await l.evaluate('a', { cases, run });
  await l.evaluate('b', { cases, run });
  l.promote('a');
  assert.throws(() => l.promote('b'), /current accepted base/);
});

test('invalid benchmark output does not mark a candidate validated', async () => {
  const l = new LearningLoop();
  l.propose({ id: 'a', description: 'candidate', artifactHash: 'hash' });
  await assert.rejects(() => l.evaluate('a', { cases, run: async () => ({ score: Infinity }) }), /invalid score/);
  assert.equal(l.candidates.get('a').status, 'proposed');
});
