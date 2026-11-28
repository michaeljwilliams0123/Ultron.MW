#!/usr/bin/env node
/**
 * Read-only, zero-credit Cloudflare Worker source & cron parity check.
 * Verifies wrangler.toml invariants and agent-relay module syntax without network calls.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const wranglerPath = join(root, 'cloudflare', 'edge-shield', 'wrangler.toml');
const relayWorkerPath = join(root, 'cloudflare', 'agent-relay', 'worker.mjs');

const errors = [];

if (!existsSync(wranglerPath)) {
  errors.push('Missing cloudflare/edge-shield/wrangler.toml');
} else {
  const toml = readFileSync(wranglerPath, 'utf8');
  if (!/^name\s*=\s*"ultron-edge-shield"/m.test(toml)) {
    errors.push('wrangler.toml: expected name = "ultron-edge-shield"');
  }
  if (!/crons\s*=\s*\[\s*"0 \*\/6 \* \* \*"\s*\]/m.test(toml)) {
    errors.push('wrangler.toml: expected [triggers] crons = ["0 */6 * * *"]');
  }
  if (!/GITHUB_REPO\s*=\s*"michaeljwilliams0123\/Ultron\.MW"/m.test(toml)) {
    errors.push('wrangler.toml: expected GITHUB_REPO = "michaeljwilliams0123/Ultron.MW"');
  }
}

if (!existsSync(relayWorkerPath)) {
  errors.push('Missing cloudflare/agent-relay/worker.mjs');
} else {
  try {
    execFileSync(process.execPath, ['--check', relayWorkerPath], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`agent-relay/worker.mjs syntax check failed: ${err.message}`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error('Cloudflare parity error:', e);
  process.exit(1);
}

console.log('Cloudflare parity OK: edge-shield wrangler.toml (crons=["0 */6 * * *"]) and agent-relay/worker.mjs verified.');
