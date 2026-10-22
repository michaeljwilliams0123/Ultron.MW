#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createComputerExecutor, normalizeComputerPlan } from '../src/computer/executor.mjs';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';
import { createOwnerConsoleAuthorizer } from '../src/computer/owner-console.mjs';

/**
 * Owner-operated entry point to the EXISTING browser executor. This is not a
 * server, GitHub Actions workflow, persistent daemon or Pages API.
 */
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3)
    throw Error('Usage: node scripts/owner-browser-run.mjs <private-plan.json>');
  // Refuse CI, redirected stdin and agent/background approval.
  const authorize = createOwnerConsoleAuthorizer();
  const configuration = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  if (!configuration || typeof configuration !== 'object' ||
      Object.keys(configuration).some(key => !['allowedOrigins', 'plan'].includes(key)))
    throw Error('Expected a plan and an explicit allowedOrigins array');

  const plan = normalizeComputerPlan(configuration.plan, {
    allowedOrigins: configuration.allowedOrigins,
  });
  if (plan.steps[0]?.action !== 'navigate')
    throw Error('Isolated browser plan must begin with explicit navigation');

  const store = createFileComputerStore(join(homedir(), '.ultron-mw', 'browser-checkpoints'));
  // Opt in to a trusted installed Chrome binary on Windows without downloading
  // Playwright's separate Chromium runtime. Unrecognized values fail closed.
  const browserChannel = process.env.ULTRON_BROWSER_CHANNEL;
  if (browserChannel !== undefined && browserChannel !== 'chrome')
    throw Error('Unsupported ULTRON_BROWSER_CHANNEL');
  const session = await launchIsolatedBrowser({
    headless: true,
    allowedOrigins: plan.allowedOrigins,
    ...(browserChannel ? { channel: browserChannel } : {}),
  });
  try {
    const executor = createComputerExecutor({
      driver: session.driver,
      store,
      allowedOrigins: plan.allowedOrigins,
      authorize,
    });
    const result = await executor.run(plan);
    // Receipts contain digests, origin and action, never typed field values.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'completed') process.exitCode = 2;
  } finally {
    await session.close();
  }
}

main().catch(error => {
  process.stderr.write('Ultron local browser execution stopped: ' + error.message + '\n');
  process.exitCode = 1;
});
