/**
 * Real, read-only external GitHub acceptance with an isolated Chrome profile.
 * Requires explicit owner configuration and the already-authenticated GitHub
 * CLI on an owner-controlled host. Does NOT reuse browser cookies, extract
 * credentials, open PRs or write anything to GitHub.
 *
 *   ULTRON_COMPUTER_GITHUB_OWNER=michaeljwilliams0123 \
 *      node scripts/computer-external-github-acceptance.mjs --read-only
 *
 * Separate evidence:
 * - GitHub CLI /user proves host-side GitHub identity.
 * - Real Playwright Page proves external browser observation.
 * - GitHub API pull readback proves current remote state.
 * - The external GitHub login page proves credential-form takeover gating.
 * It does NOT prove browser SSO, owner-entered MFA, or external SaaS writes.
 */
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';
import { createComputerExecutor, createMemoryComputerStore } from '../src/computer/executor.mjs';
import { createGitHubCliOwnerVerifier } from '../src/computer/github-owner-verifier.mjs';

const run = promisify(execFile);
const owner = process.env.ULTRON_COMPUTER_GITHUB_OWNER;
if (process.argv.slice(2).join(' ') !== '--read-only')
  throw Error('Explicit --read-only required');
const verifyOwner = createGitHubCliOwnerVerifier({ ownerLogin: owner });
if (!await verifyOwner()) throw Error('Authenticated GitHub host identity did not match owner');

const repo = owner + '/Ultron.MW';
const remote = await run('gh', [
  'api', '--hostname', 'github.com', '--method', 'GET',
  'repos/' + repo + '/pulls/72', '--jq',
  '{number: .number, title: .title, head: .head.sha, draft: .draft}',
], { timeout: 10000, windowsHide: true, maxBuffer: 8192 });
const pr = JSON.parse(remote.stdout);
assert.equal(pr.number, 72);
assert.match(pr.head, /^[a-f0-9]{40}$/);
const origin = 'https://github.com';
const url = origin + '/' + repo + '/pull/72';
const browser = await launchIsolatedBrowser({
  headless: true, channel: 'chrome', allowedOrigins: [origin],
});
let publicBrowser;
try {
  const executor = createComputerExecutor({
    driver: browser.driver, store: createMemoryComputerStore(),
    allowedOrigins: [origin],
  });
  const result = await executor.run({ id: 'public-github-pr-readback', steps: [
    { action: 'navigate', url, expect: { urlIncludes: '/pull/72' } },
    { action: 'observe', expect: { urlIncludes: '/pull/72' } },
  ] });
  assert.equal(result.status, 'completed');
  const screen = await browser.driver.observe();
  assert.equal(screen.url, url);
  assert.equal(result.receipts.length, 2);
  // GitHub's canonical authenticated API is the exact-head source of truth.
  publicBrowser = {
    urlMatches: screen.url === url,
    titleVisible: screen.text.includes(pr.title),
    actionReceipts: result.receipts.length,
    screenshotDigest: screen.screenshotDigest,
    accessibilityDigest: screen.accessibilityDigest,
  };
} finally {
  await browser.close();
}
const loginBrowser = await launchIsolatedBrowser({
  headless: true, channel: 'chrome', allowedOrigins: [origin],
});
let pauseEvidence;
try {
  let actionCalls = 0;
  const driver = {
    observe: () => loginBrowser.driver.observe(),
    async perform(step) {
      actionCalls++;
      return loginBrowser.driver.perform(step);
    },
  };
  const executor = createComputerExecutor({
    driver, store: createMemoryComputerStore(), allowedOrigins: [origin],
    authorize: async () => { throw Error('No AI credential entry permitted'); },
  });
  const result = await executor.run({ id: 'live-github-login-takeover', steps: [
    { action: 'navigate', url: origin + '/login',
      expect: { urlIncludes: '/login' } },
    { action: 'type', selector: '#login_field', value: 'non-secret-test',
      expect: { textIncludes: 'Signed in' } },
  ] });
  const observed = await loginBrowser.driver.observe();
  assert.equal(result.status, 'owner-takeover-required');
  assert.equal(result.receipts.length, 1);
  assert.equal(actionCalls, 1); // Only the initial, read-only navigation.
  assert.equal(observed.requiresOwnerTakeover, true);
  pauseEvidence = { status: result.status, typedCredentials: false };
} finally {
  await loginBrowser.close();
}
process.stdout.write(JSON.stringify({
  evidence: 'REAL_EXTERNAL_GITHUB_READONLY_PLUS_AUTHENTICATED_HOST',
  ownerVerifiedViaGitHubCli: true,
  prHeadFromAuthenticatedGitHubApi: pr.head,
  draft: pr.draft,
  browser: publicBrowser,
  credentialChallenge: pauseEvidence,
  externalBrowserSignedIn: 'NOT_PROVEN',
  mfaCompleted: 'NOT_PROVEN',
  externalApplicationWrite: 'NOT_PERFORMED',
}, null, 2) + '\n');
