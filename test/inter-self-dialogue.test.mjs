import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterSelfDialogue,
  formatDialogueMarkdown,
} from '../src/inter-self-dialogue.mjs';

test('standby dialogue is deterministic multi-turn', () => {
  const a = buildInterSelfDialogue({
    mode: 'standby',
    objective: 'standby: wait for owner',
    decision: 'proceed',
    observedAt: '2026-10-29T00:00:00.000Z',
  });
  const b = buildInterSelfDialogue({
    mode: 'standby',
    objective: 'standby: wait for owner',
    decision: 'proceed',
    observedAt: '2026-10-29T00:00:00.000Z',
  });
  assert.deepEqual(a, b);
  assert.equal(a.kind, 'ultron-inter-self-dialogue');
  assert.ok(a.turnCount >= 6);
  assert.equal(a.modelInvocations, 0);
  assert.match(a.transcript, /Companion:/);
  assert.match(a.transcript, /Skeptic:/);
});

test('active dialogue reflects decision and dissent', () => {
  const hold = buildInterSelfDialogue({
    mode: 'active',
    objective: 'expand autonomy',
    decision: 'hold',
    dissent: ['security-sensitive-language'],
    observedAt: '2026-10-29T00:00:00.000Z',
  });
  assert.match(hold.transcript, /HOLD|Hold|hold/);
  assert.match(hold.transcript, /security-sensitive-language/);
  const md = formatDialogueMarkdown(hold);
  assert.match(md, /Inter-self dialogue/);
  assert.match(md, /advisory-only/);
});
