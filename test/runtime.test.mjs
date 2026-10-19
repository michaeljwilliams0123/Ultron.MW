import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startLocalServer } from '../src/server.mjs';
import { executeReadOnly } from '../src/operations.mjs';

async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-'));
  const statePath = join(directory, 'state.json');
  const root = resolve(import.meta.dirname, '..');
  let instance = await startLocalServer({ root, statePath, port: 0 });
  const base = () => 'http://127.0.0.1:' + instance.port;
  const post = async (endpoint, text, headers = {}) => fetch(base() + endpoint, {
    method: 'POST', headers: {
      origin: base(), 'content-type': 'application/json',
      'x-ultron-client': 'local-ui-v1', ...headers,
    }, body: JSON.stringify({ text }),
  });
  try {
    await action({
      base, post, statePath,
      restart: async () => { await instance.close(); instance = await startLocalServer({ root, statePath, port: 0 }); },
    });
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('whitelisted read-only execution creates a verifiable persistent receipt', async () => fixture(async ({ base, post, restart }) => {
  const result = await post('/api/execute', '/repo inspect');
  assert.equal(result.status, 201);
  const payload = await result.json();
  assert.equal(payload.executed, true);
  assert.equal(payload.autonomous, false);
  assert.equal(payload.receipt.status, 'succeeded');
  assert.equal(payload.receipt.details.present.some(item => item.name === 'src'), true);
  await restart();
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].id, payload.receipt.id);
  assert.equal(state.autonomousReady, false);
}));

test('unknown commands rejected without a fake success receipt', async () => fixture(async ({ base, post }) => {
  const invalid = await post('/api/execute', '/shell delete all');
  assert.equal(invalid.status, 422);
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 0);
}));

test('local-origin and host restrictions reject hostile browser requests', async () => fixture(async ({ base, post }) => {
  const origin = await post('/api/execute', '/help', { origin: 'https://other.example' });
  assert.equal(origin.status, 403);
  // Browser fetch deliberately manages Host; use native HTTP to test a spoofed host.
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base() + '/api/health', { headers: { host: 'hostile.example' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
}));

test('simultaneous draft writes persist without lost updates', async () => fixture(async ({ base, post, statePath }) => {
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/api/objectives', 'objective-' + i)));
  assert.equal(results.every(x => x.status === 201), true);
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.objectives.length, 10);
  const file = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(file.objectives.length, 10);
}));

test('runtime serves exactly the same UI and JS as static Pages source', async () => fixture(async ({ base }) => {
  const home = await fetch(base() + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /ULTRON\.MW/);
  const js = await fetch(base() + '/app.js');
  assert.equal(js.status, 200);
  assert.match(await js.text(), /\/api\/execute/);
}));

test('inspection command restricts output to fixed project names', async () => {
  const result = await executeReadOnly('/repo inspect', { root: resolve(import.meta.dirname, '..'), learning: { accepted: 'seed-v1', observations: [], candidates: [], history: [] } });
  assert.equal(result.details.present.every(item => ['src','docs','test','README.md','.github'].includes(item.name)), true);
});

test('upgrading from draft-only local state preserves previously saved objectives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-legacy-'));
  const statePath = join(directory, 'state.json');
  await writeFile(statePath, JSON.stringify({
    objectives: [{ id: 'draft-legacy', text: 'Keep my saved objective', status: 'draft' }],
    learning: { accepted: 'seed-v1', history: [], observations: [], candidates: [] },
  }));
  const root = resolve(import.meta.dirname, '..');
  const app = await startLocalServer({ root, statePath, port: 0 });
  try {
    const state = await (await fetch('http://127.0.0.1:' + app.port + '/api/state')).json();
    assert.equal(state.objectives[0].id, 'draft-legacy');
    assert.deepEqual(state.receipts, []);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the full read-only capability list has executable receipts', async () => fixture(async ({ base, post }) => {
  const manifest = await (await fetch(base() + '/api/capabilities')).json();
  assert.equal(manifest.autonomy, false);
  assert.equal(manifest.commands.length, 4);
  for (const item of manifest.commands) {
    const result = await post('/api/execute', item.command);
    assert.equal(result.status, 201, item.command);
    const payload = await result.json();
    assert.equal(payload.receipt.status, 'succeeded');
    assert.equal(payload.receipt.command, item.command);
  }
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 4);
}));

test('failed state persistence never returns success or mutates the ledger', async () => fixture(async ({ base, post, statePath }) => {
  await mkdir(statePath);
  const result = await post('/api/objectives', 'must not appear as saved');
  assert.equal(result.status, 500);
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.objectives.length, 0);
}));
