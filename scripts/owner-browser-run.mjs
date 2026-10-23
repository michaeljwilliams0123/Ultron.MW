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
import { selectSafeBrowserSession } from '../src/computer/session-resume.mjs';

/**
 * Owner-operated isolated browser. GitHub CLI authenticates the HOST only.
 * Interactive actions require independent local owner approval; passwords,
 * session cookies and MFA never pass through Ultron or its checkpoints.
 */
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3)
    throw Error('Usage: node scripts/owner-browser-run.mjs <private-plan.json>');

  // Reject CI, redirected stdin/output and simulated terminal consent.
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

  const rootPlan = normalizeComputerPlan(configuration.plan, {
    allowedOrigins: configuration.allowedOrigins,
  });
  if (rootPlan.steps[0]?.action !== 'navigate')
    throw Error('Isolated browser plan must begin with explicit navigation');

  const headed = process.env.ULTRON_COMPUTER_HEADED === '1';
  const channel = process.env.ULTRON_BROWSER_CHANNEL;
  if (channel !== undefined && channel !== 'chrome')
    throw Error('Unsupported ULTRON_BROWSER_CHANNEL');

  const store = createFileComputerStore(join(homedir(), '.ultron-mw',
    'browser-checkpoints'));

  // The root lock spans lineage selection, opening Chrome, manual MFA, user
  // approval, application execution and close. Two retries can never reserve
  // siblings while one already-approved action remains in flight.
  await store.withLock(rootPlan.id, async () => {
    const restart = await selectSafeBrowserSession(rootPlan, store);
    const plan = restart.plan;
    if (restart.restarted) {
      process.stderr.write(
        'Previous browser checkpoint retained; restarting passive navigation ' +
        'under a linked objective ID.\n');
    }

    const browser = await launchIsolatedBrowser({
      headless: !headed, ownerApproval: headed,
      allowedOrigins: plan.allowedOrigins,
      enableTabs: process.env.ULTRON_BROWSER_MULTITAB === '1',
      uploadRoot: process.env.ULTRON_BROWSER_UPLOAD_ROOT,
      downloadRoot: process.env.ULTRON_BROWSER_DOWNLOAD_ROOT,
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
      // Root is already exclusively locked; do not attempt to lock that ID
      // again. Child objectives retain their own independent lock in addition
      // to the root lock.
      const executionStore = plan.id === rootPlan.id
        ? { read: store.read, write: store.write }
        : store;
      const executor = createComputerExecutor({
        driver: browser.driver, store: executionStore,
        allowedOrigins: plan.allowedOrigins,
        canContinue: authority.canContinue,
        authorize: authority.authorize,
      });
      let result = await executor.run(plan);
      // A human may complete login or MFA directly in isolated headed Chrome.
      // The owner must separately authorize the subsequent active action.
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
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status !== 'completed') process.exitCode = 2;
    } finally {
      authority.revoke();
      await browser.close();
    }
  });
}
main().catch(error => {
  process.stderr.write('Ultron owner browser stopped: ' + error.message + '\n');
  process.exitCode = 1;
});
