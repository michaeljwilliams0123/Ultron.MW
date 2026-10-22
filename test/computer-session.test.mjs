import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createComputerSessionAuthority } from '../src/computer/session-authority.mjs';
import { createPlaywrightComputerDriver } from '../src/computer/playwright-driver.mjs';
import { createComputerExecutor, createMemoryComputerStore } from '../src/computer/executor.mjs';

const origin = 'https://example.test';
const deadline = '2026-10-22T06:20:00.000Z';
const base = { sessionId: 'owner-ephemeral-1', expiresAt: deadline,
  allowedOrigins: [origin], clock: () => Date.parse('2026-10-22T06:00:00.000Z') };
const click = { action: 'click', planId: 'test', planFingerprint: 'f'.repeat(64),
  currentOrigin: origin, stepId: 'send', selector: 'button',
  expectedState: { textIncludes: 'Saved' } };

test('operator approval requires an independent current owner-session check', async () => {
  let prompted = 0;
  const authority = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => false,
    requestApproval: async () => { prompted++; return true; } });
  assert.equal(await authority.authorize(click), false);
  assert.equal(prompted, 0);
});
test('owner session rejects foreign origin and expires before asking for permission', async () => {
  let time = Date.parse('2026-10-22T06:00:00.000Z'), approvals = 0;
  const a = createComputerSessionAuthority({ ...base, clock: () => time,
    verifyOwner: async () => true,
    requestApproval: async () => { approvals++; return true; } });
  assert.equal(await a.authorize({ ...click, currentOrigin: 'https://other.test' }), false);
  time = Date.parse(deadline);
  assert.equal(await a.authorize(click), false);
  assert.equal(a.status, 'expired');
  assert.equal(approvals, 0);
});
test('revoking session during pending approval cannot authorize a click', async () => {
  let a;
  a = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => true,
    requestApproval: async () => { a.revoke(); return true; } });
  assert.equal(await a.authorize(click), false);
  assert.equal(a.status, 'revoked');
});
test('bounded approvals never allow an extra action', async () => {
  let calls = 0;
  const a = createComputerSessionAuthority({ ...base,
    maxApprovals: 1, verifyOwner: async () => true,
    requestApproval: async () => { calls++; return true; } });
  assert.equal(await a.authorize(click), true);
  assert.equal(await a.authorize(click), false);
  assert.equal(calls, 1);
  assert.equal(a.status, 'exhausted');
});
test('session input rejects excessive lifetimes, missing trusted callbacks and weak origins', () => {
  assert.throws(() => createComputerSessionAuthority({
    ...base, expiresAt: '2026-10-22T12:00:00Z',
    verifyOwner: async () => true, requestApproval: async () => true }), /configuration/);
  assert.throws(() => createComputerSessionAuthority({
    ...base, verifyOwner: async () => true }), /configuration/);
  assert.throws(() => createComputerSessionAuthority({
    ...base, allowedOrigins: ['http://example.test'],
    verifyOwner: async () => true, requestApproval: async () => true }), /configuration/);
});
test('Playwright observation gives hashes of screenshot and accessibility tree, never bytes', async () => {
  const pixels = Buffer.from('synthetic-png-test');
  const accessibility = '- main: Form\n- button: Send';
  const body = { innerText: async () => 'Form ready',
    ariaSnapshot: async () => accessibility };
  const page = { goto: async () => {}, url: () => origin,
    title: async () => 'Form', locator: () => body,
    screenshot: async () => pixels };
  const driver = createPlaywrightComputerDriver(page);
  const obs = await driver.observe();
  const hash = buf => createHash('sha256').update(buf).digest('hex');
  assert.equal(obs.screenshotDigest, hash(pixels));
  assert.equal(obs.accessibilityDigest, hash(accessibility));
  assert.equal(JSON.stringify(obs).includes('synthetic-png-test'), false);
  assert.equal(JSON.stringify(obs).includes('button: Send'), false);
  let submissions = 0;
  const store = createMemoryComputerStore();
  const executor = createComputerExecutor({ driver: {
    ...driver, perform: async () => { submissions++; },
  }, store, allowedOrigins: [origin], authorize: async () => true });
  // A URL/text/title change is still necessary to verify a click;
  // screenshot hash alone must not falsely certify an unchanged page.
  assert.equal((await executor.run({ id: 'unchanged-visual',
    steps: [{ action: 'click', selector: 'button',
      expect: { textIncludes: 'Saved' } }] })).status, 'reconcile-required');
  assert.equal(submissions, 1);
});
