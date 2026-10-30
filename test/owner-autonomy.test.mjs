import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerAutonomyEnabled,
  autonomyLimits,
  autonomyHardFloors,
  autonomyDoctrine,
} from '../src/owner-autonomy.mjs';

test('baseline when flags off', () => {
  assert.equal(ownerAutonomyEnabled({}), false);
  assert.equal(autonomyLimits({}).maxFiles, 4);
  assert.equal(autonomyLimits({}).mode, 'baseline');
});

test('owner autonomy raises budgets', () => {
  for (const key of ['OWNER_MODE', 'ULTRON_AUTONOMY', 'ULTRON_VELOCITY']) {
    const env = { [key]: '1' };
    assert.equal(ownerAutonomyEnabled(env), true);
    assert.equal(autonomyLimits(env).maxFiles, 12);
    assert.ok(autonomyLimits(env).governorMinEvidence < 0.7);
  }
});

test('hard floors always present', () => {
  const f = autonomyHardFloors();
  assert.equal(f.noPushToProtectedMainFromCouncil, true);
  assert.equal(f.syntaxPreflightRequired, true);
  assert.equal(f.noFailOpenRequiredCi, true);
  assert.match(autonomyDoctrine().slogan, /works for the owner/);
});
