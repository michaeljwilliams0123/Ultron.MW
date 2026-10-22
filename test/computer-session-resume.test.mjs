import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeComputerPlan } from '../src/computer/executor.mjs';
import { restartSafeBrowserPlan } from '../src/computer/session-resume.mjs';

const original = normalizeComputerPlan({
  id: 'owner-github-live-browser-acceptance',
  steps: [
    { id: 'login', action: 'navigate', url: 'https://github.com/login' },
    { id: 'profile', action: 'navigate', url: 'https://github.com/settings/profile' },
    { id: 'approve', action: 'click', selector: 'a[href="/settings/emails"]',
      expect: { urlIncludes: '/settings/emails' } },
  ],
}, { allowedOrigins: ['https://github.com'] });
const fingerprint = createHash('sha256')
  .update(JSON.stringify(original)).digest('hex');
const state = (completed, extras = {}) => ({
  id: original.id, fingerprint, status: 'approval-required',
  completed, receipts: [], pending: null, ...extras,
});
const suffix = () => 'abcdef123456';

test('without checkpoint the original plan is retained', () => {
  const result = restartSafeBrowserPlan(original, null);
  assert.equal(result.restarted, false);
  assert.equal(result.plan, original);
});
test('old completed navigations safely restart from the first page with a new objective', () => {
  const result = restartSafeBrowserPlan(original, state(['login', 'profile']), { suffix });
  assert.equal(result.restarted, true);
  assert.equal(result.priorId, original.id);
  assert.notEqual(result.plan.id, original.id);
  assert.match(result.plan.id, /\.abcdef123456$/);
  assert.equal(result.plan.steps.length, original.steps.length);
  assert.equal(result.plan.steps[0].url, 'https://github.com/login');
  assert.deepEqual(result.plan.allowedOrigins, original.allowedOrigins);
});
test('default cryptographic session suffix is accepted without test injection', () => {
  const first = restartSafeBrowserPlan(original, state(['login', 'profile']));
  const second = restartSafeBrowserPlan(original, state(['login', 'profile']));
  assert.equal(first.restarted, true);
  assert.match(first.plan.id, /\.[a-f0-9]{16}$/);
  assert.notEqual(first.plan.id, second.plan.id);
  assert.equal(first.plan.steps[0].url, original.steps[0].url);
  assert.equal(first.priorId, original.id);
});

test('old interactive action, even if marked completed, never auto-restarts', () => {
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login', 'profile', 'approve']), { suffix }), /interactive actions/);
});
test('pending or ambiguous action never restarts', () => {
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login'], { pending: 'profile' }), { suffix }), /reconcile/);
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login'], { status: 'reconcile-required' }), { suffix }), /reconcile/);
});
test('plan mutation or corrupt checkpoint cannot automatically bypass evidence', () => {
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login'], { fingerprint: '0'.repeat(64) }), { suffix }), /does not match/);
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['profile']), { suffix }), /Invalid browser checkpoint/);
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login','login']), { suffix }), /Invalid browser checkpoint/);
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login'], { status: 'invalid' }), { suffix }), /Invalid browser checkpoint state/);
});
test('malformed or repeated objective identifier suffix rejected', () => {
  assert.throws(() => restartSafeBrowserPlan(original,
    state(['login']), { suffix: () => 'bad/id' }), /Invalid browser session suffix/);
});
