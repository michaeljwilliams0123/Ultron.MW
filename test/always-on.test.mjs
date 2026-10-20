import test from 'node:test';
import assert from 'node:assert/strict';
import { standbyTick, isAlwaysOnEnabled } from '../src/always-on.mjs';

test('standby tick is advisory waiting-for-owner', () => {
  const tick = standbyTick({ observedAt: '2026-10-19T22:00:00.000Z' });
  assert.equal(tick.kind, 'ultron-standby-receipt');
  assert.equal(tick.mode, 'standby');
  assert.equal(tick.posture, 'waiting-for-owner');
  assert.equal(tick.authority.executable, false);
  assert.equal(tick.modelInvocations, 0);
  assert.ok(tick.selvesActive.length >= 3);
  assert.match(tick.fingerprint, /^[a-f0-9]{64}$/);
});

test('always-on env gate', () => {
  assert.equal(isAlwaysOnEnabled({ env: {} }), false);
  assert.equal(isAlwaysOnEnabled({ env: { ULTRON_ALWAYS_ON: '1' } }), true);
});
