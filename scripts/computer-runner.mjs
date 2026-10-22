/**
 * Owner-operated proof runner: node scripts/computer-runner.mjs <plan.json>
 *
 * Requires separate, explicitly installed Playwright browser runtime.
 * Never reads an existing browser profile or attempts background execution.
 * Any click/type/keypress requires an interactive local operator to type
 * APPROVE followed by the exact step ID. No response means DENY.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { createBoundComputerExecutor } from '../src/computer/binding-contract.mjs';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';

async function main() {
  if (process.argv.length !== 3)
    throw Error('Usage: node scripts/computer-runner.mjs path-to-plan.json');
  const raw = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const allowedOrigins = JSON.parse(process.env.ULTRON_COMPUTER_ALLOWED_ORIGINS || '[]');
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length)
    throw Error('Set ULTRON_COMPUTER_ALLOWED_ORIGINS to a JSON origin array');
  const binding = {
    id: 'owner-browser-0', kind: 'computer.browser',
    runtime: 'local-node', enabled: true, allowedOrigins,
    operations: ['navigate','observe','extract','wait','click','type','keypress','scroll'],
    maxSteps: 30,
  };
  const input = createInterface({ input: process.stdin, output: process.stderr });
  let instance;
  try {
    instance = await launchIsolatedBrowser({ headless: true });
    const executor = createBoundComputerExecutor({
      binding, driver: instance.driver,
      store: createFileComputerStore(resolve('.local', 'computer-checkpoints')),
      authorize: async ({ stepId, action, currentOrigin }) => {
        if (!process.stdin.isTTY) return false;
        const challenge = 'APPROVE ' + stepId;
        const reply = await input.question(
          'Authorize ' + action + ' on ' + currentOrigin +
          ' for step ' + stepId + '? Enter "' + challenge + '": ');
        return reply.trim() === challenge;
      },
    });
    const result = await executor.run(raw);
    // Reports only hashes, action names and origins, never typed values.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'completed') process.exitCode = 2;
  } finally {
    input.close();
    if (instance) await instance.close();
  }
}
if (process.argv[1] && import.meta.url ===
    new URL('file://' + fileURLToPath(import.meta.url).replace(/\\/g, '/')).href) {
  main().catch(error => {
    process.stderr.write('Computer run blocked: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
