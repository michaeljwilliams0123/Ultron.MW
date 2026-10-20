import test from 'node:test';
import assert from 'node:assert/strict';
import {
  velocityEnabled,
  multifileLimits,
  governorSoftHold,
  observerMode,
  verifyPolicy,
} from '../src/velocity.mjs';

test('velocity default off', () => {
  assert.equal(velocityEnabled({}), false);
  assert.equal(multifileLimits({}).maxFiles, 4);
  assert.equal(observerMode({}), 'active');
  assert.equal(verifyPolicy({}).mode, 'blocking');
});

test('velocity on raises limits and softens policy', () => {
  const env = { ULTRON_VELOCITY: '1' };
  assert.equal(velocityEnabled(env), true);
  assert.equal(multifileLimits(env).maxFiles, 12);
  assert.ok(multifileLimits(env).maxTotalBytes > 18000);
  assert.ok(governorSoftHold(env).minEvidence < 0.7);
  assert.equal(observerMode(env), 'passive');
  assert.equal(verifyPolicy(env).mode, 'advisory');
});
