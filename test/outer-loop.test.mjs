import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExecutionPlan,
  OuterLoopSession,
  planFromWorkbenchVerb,
} from '../src/outer-loop.mjs';

test('normalizeExecutionPlan validates shape', () => {
  assert.equal(normalizeExecutionPlan({}).ok, false);
  const ok = normalizeExecutionPlan({
    summary: 'Read issue',
    steps: [{ id: '1', action: 'github.issue.read', args: { number: 3 } }],
    requires_human_approval: false,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.steps.length, 1);
});

test('human approval gate', async () => {
  const s = new OuterLoopSession({ sessionId: 't1' });
  const denied = await s.executePlan({
    summary: 'Dangerous',
    steps: [{ action: 'github.issue.comment', args: { number: 1, body: 'x' } }],
    requires_human_approval: true,
  }, {}, { OWNER_MODE: '1' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'human-approval-required');
});

test('workbench step via adapter', async () => {
  const s = new OuterLoopSession({ sessionId: 't2' });
  const plan = planFromWorkbenchVerb('github.issue.read', { number: 7 });
  const out = await s.executePlan(plan, {
    github: { request: async (verb, args) => ({ verb, args, title: 'Hello' }) },
  }, { OWNER_MODE: '1' });
  assert.equal(out.ok, true);
  assert.equal(out.stepResults[0].result.title, 'Hello');
});

test('council advise is deterministic advisory', () => {
  const s = new OuterLoopSession({ sessionId: 't3' });
  const a = s.councilAdvise('inspect repo', { observedAt: '2026-10-29T00:00:00.000Z' });
  const b = s.councilAdvise('inspect repo', { observedAt: '2026-10-29T00:00:00.000Z' });
  assert.equal(a.receipt.fingerprint, b.receipt.fingerprint);
  assert.equal(a.receipt.modelInvocations, 0);
});

test('sliding context window', () => {
  const s = new OuterLoopSession({ sessionId: 't4', maxHistory: 5 });
  for (let i = 0; i < 20; i++) s.append('user', `msg-${i}`);
  assert.ok(s.history.length <= 5);
  assert.equal(s.history[0].role, 'system');
});
