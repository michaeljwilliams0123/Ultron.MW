#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createComputerExecutor, normalizeComputerPlan } from '../src/computer/executor.mjs';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';
import { createOwnerConsoleAuthorizer } from '../src/computer/owner-console.mjs';
import { createComputerSessionAuthority } from '../src/computer/session-authority.mjs';
import { createGitHubCliOwnerVerifier } from '../src/computer/github-owner-verifier.mjs';

/**
 * Canonical owner-operated browser entry point. The independent terminal
 * challenge from PR #73 is preserved and paired with a REAL GitHub CLI
 * identity check. No token, profile, cookie or MFA code reaches Playwright.
 *
 * Interactive headed mode is opt-in and requires a real local TTY so that
 * an owner can complete login/MFA directly inside a fresh browser profile.
 */
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3)
    throw Error('Usage: node scripts/owner-browser-run.mjs <private-plan.json>');

  // Refuse CI, redirected stdin/output, pipes and simulated approvals.
  const approveOnce = createOwnerConsoleAuthorizer();
  const verifyGithubOwner = createGitHubCliOwnerVerifier({
    ownerLogin: process.env.ULTRON_COMPUTER_GITHUB_OWNER,
  });
  if (!await verifyGithubOwner())
    throw Error('GitHub CLI has no authenticated session for the declared owner');

  const configuration = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  if (!configuration || typeof configuration !== 'object' ||
      Object.keys(configuration).some(key => !['allowedOrigins', 'plan'].includes(key)))
    throw Error('Expected a plan and an explicit allowedOrigins array');

  const plan = normalizeComputerPlan(configuration.plan, {
    allowedOrigins: configuration.allowedOrigins,
  });
  if (plan.steps[0]?.action !== 'navigate')
    throw Error('Isolated browser plan must begin with explicit navigation');

  const headed = process.env.ULTRON_COMPUTER_HEADED === '1';
  const channel = process.env.ULTRON_BROWSER_CHANNEL;
  if (channel !== undefined && channel !== 'chrome')
    throw Error('Unsupported ULTRON_BROWSER_CHANNEL');

  const store = createFileComputerStore(join(homedir(), '.ultron-mw',
    'browser-checkpoints'));
  const browser = await launchIsolatedBrowser({
    headless: !headed, ownerApproval: headed,
    allowedOrigins: plan.allowedOrigins,
    ...(channel ? { channel } : {}),
  });
  const authority = createComputerSessionAuthority({
    sessionId: 'owner-' + randomUUID(),
    allowedOrigins: plan.allowedOrigins,
    expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    maxApprovals: 30,
    verifyOwner: verifyGithubOwner,
    requestApproval: approveOnce,
  });
  try {
    const executor = createComputerExecutor({
      driver: browser.driver, store,
      allowedOrigins: plan.allowedOrigins,
      canContinue: authority.canContinue,
      authorize: authority.authorize,
    });
    let result = await executor.run(plan);
    // Password, OTP and MFA controls are never driven by this runner.
    // The owner may directly take control of a headed, isolated Chrome window.
    for (let tries = 0; result.status === 'owner-takeover-required' &&
        headed && tries < 3; tries++) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      let answer;
      try {
        answer = await rl.question(
          'Owner takeover: complete login/MFA in the Chrome window. ' +
          'Type RESUME after completion (anything else denies): ',
          { signal: AbortSignal.timeout(180000) },
        );
      } catch { break; }
      finally { rl.close(); }
      if (answer.trim() !== 'RESUME') break;
      result = await executor.run(plan);
    }
    // Return only evidence hashes, action types and allowed origins.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'completed') process.exitCode = 2;
  } finally {
    authority.revoke();
    await browser.close();
  }
}
main().catch(error => {
  process.stderr.write('Ultron owner browser stopped: ' + error.message + '\n');
  process.exitCode = 1;
});
