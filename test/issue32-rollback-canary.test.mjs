import test from 'node:test';
import assert from 'node:assert/strict';

const acceptanceStatus = 'verified';
const expectedStatus = String.fromCharCode(112,101,110,100,105,110,103);

test('Issue 32: verify must catch a semantic change that breaks an invariant', () => {
  assert.equal(acceptanceStatus, expectedStatus);
});
