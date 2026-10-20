import test from 'node:test';
import assert from 'node:assert/strict';
import { missionState } from '../src/work-mission-canary.mjs';

test('post-merge source canary remains synchronized', () => {
  assert.equal(missionState, 'verified');
});
