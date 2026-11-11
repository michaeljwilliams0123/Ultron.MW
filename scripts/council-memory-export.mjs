#!/usr/bin/env node
// Export a verified council memory snapshot into the two git-carried mirrors:
//   evidence/council-memory/<sha256>.json  (GitLab via the existing mirror)
//   gitbook/council-journal.md            (GitBook via Git Sync)
// Dry run by default: prints the plan. --write writes the files locally so they
// can go into a reviewed PR. Never pushes, never calls GitLab or GitBook.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planGitLabMirror, planGitBookPublish } from '../src/council-memory-store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [file, flag] = process.argv.slice(2);
if (!file) { console.error('usage: ULTRON_COUNCIL_MEMORY_HMAC_KEY=... node scripts/council-memory-export.mjs <sealed-snapshot.json> [--write]'); process.exit(2); }
// Input is the sealed envelope from GET /api/brain/council-memory. Without the
// owner's HMAC key the seal cannot be checked, so nothing is written.
const key = process.env.ULTRON_COUNCIL_MEMORY_HMAC_KEY;
if (!key) { console.error('BLOCKED: ULTRON_COUNCIL_MEMORY_HMAC_KEY is not set; refusing to export an unverified snapshot.'); process.exit(3); }
const sealed = JSON.parse(await readFile(resolve(file), 'utf8'));
const plans = [planGitLabMirror(sealed, key), planGitBookPublish(sealed, key)];
for (const plan of plans) {
  console.log(plan.adapter + ' -> ' + plan.path + ' (' + plan.content.length + ' bytes)\n  ' + plan.route);
  if (flag === '--write') {
    const target = resolve(root, plan.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, plan.content);
  }
}
if (flag !== '--write') console.log('Dry run. Re-run with --write to create the files for a PR.');
