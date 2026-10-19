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
  assert.equal(manifest.commands.length, 5);
  for (const item of manifest.commands) {
    const result = await post('/api/execute', item.command);
    assert.equal(result.status, 201, item.command);
    const payload = await result.json();
    assert.equal(payload.receipt.status, 'succeeded');
    assert.equal(payload.receipt.command, item.command);
  }
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 5);
}));

test('failed state persistence never returns success or mutates the ledger', async () => fixture(async ({ base, post, statePath }) => {
  await mkdir(statePath);
  const result = await post('/api/objectives', 'must not appear as saved');
  assert.equal(result.status, 500);
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.objectives.length, 0);
}));


test('explicit objective plan persists before executing any tools; repeating run is idempotent', async () => fixture(async ({ base, post, restart }) => {
  const initial = await post('/api/plan', 'inspect repo');
  assert.equal(initial.status, 201);
  const planned = (await initial.json()).plan;
  assert.equal(planned.steps.length, 1);
  assert.equal(planned.steps[0].status, 'ready');
  assert.equal(planned.autonomous, false);
  let state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 0);
  const runRequest = () => fetch(base() + '/api/plan/run', {
    method: 'POST',
    headers: { origin: base(), 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
    body: JSON.stringify({ id: planned.id }),
  });
  const two = await Promise.all([runRequest(), runRequest()]);
  assert.deepEqual(two.map(x => x.status), [200, 200]);
  await restart();
  state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 1);
  assert.equal(state.plans[0].status, 'completed');
  assert.equal(state.plans[0].steps[0].receiptId, state.receipts[0].id);
}));

test('unsupported and destructive objective steps are never executed', async () => fixture(async ({ base, post }) => {
  const planResult = await post('/api/plan', 'delete every file');
  assert.equal(planResult.status, 201);
  const plan = (await planResult.json()).plan;
  assert.equal(plan.executable, false);
  assert.equal(plan.steps[0].status, 'blocked');
  const reply = await fetch(base() + '/api/plan/run', {
    method: 'POST',
    headers: { origin: base(), 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
    body: JSON.stringify({ id: plan.id }),
  });
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).executed, false);
  const state = await (await fetch(base() + '/api/state')).json();
  assert.equal(state.receipts.length, 0);
}));

test('local routing evaluation persists versioned strategy, and rollback restores original', async () => fixture(async ({ base, post, restart }) => {
  const before = await (await fetch(base() + '/api/state')).json();
  assert.equal(before.evolution.accepted, 'routing-v1');
  const evaluateRequest = () => fetch(base() + '/api/learning/evaluate', {
    method: 'POST',
    headers: { origin: base(), 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
    body: '{}',
  });
  const result = await evaluateRequest();
  assert.equal(result.status, 200);
  const evaluation = (await result.json()).evaluation;
  assert.equal(evaluation.status, 'adopted');
  assert.equal(evaluation.criticalRegressions, 0);
  assert.equal(evaluation.promotion.kind, 'routing-promotion-receipt');
  assert.equal(evaluation.promotion.incumbentVersion, 'routing-v1');
  assert.equal(evaluation.promotion.candidateVersion, 'routing-v2');
  assert.equal(evaluation.promotion.authorityUnchanged, true);
  await restart();
  const after = await (await fetch(base() + '/api/state')).json();
  assert.equal(after.evolution.accepted, 'routing-v2');
  assert.equal(after.evolution.evaluations.length, 1);
  assert.equal(after.evolution.evaluations[0].promotion.commitStage, 'commit');
  const repeat = await evaluateRequest();
  assert.equal((await repeat.json()).evaluation.status, 'already-adopted');
  const rollback = await fetch(base() + '/api/learning/rollback', {
    method: 'POST',
    headers: { origin: base(), 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
    body: JSON.stringify({ reason: 'owner-request' }),
  });
  assert.equal(rollback.status, 200);
  assert.equal((await rollback.json()).accepted, 'routing-v1');
}));

test('public shared core source is the only added served module surface', async () => fixture(async ({ base }) => {
  for (const filename of ['/core/cycle.mjs', '/core/providers.mjs', '/core/capabilities.mjs', '/core/cloud-submit.mjs']) {
    const result = await fetch(base() + filename);
    assert.equal(result.status, 200);
    assert.match(await result.text(), /export /);
  }
  const blocked = await fetch(base() + '/.local/state.json');
  assert.equal(blocked.status, 404);
}));


test('local model conversation survives runtime restart and informs subsequent turns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-context-'));
  const statePath = join(directory, 'state.json');
  const root = resolve(import.meta.dirname, '..');
  const requests = [];
  const provider = {
    status: async () => ({ ready: true, model: 'test-local' }),
    respond: async messages => {
      requests.push(messages);
      return { model: 'test-local', decision: { action: 'reply',
        text: requests.length === 1 ? 'First factual response' : 'Continued factual response' } };
    },
  };
  let app = await startLocalServer({ root, statePath, port: 0, provider });
  const send = async text => {
    const origin = 'http://127.0.0.1:' + app.port;
    return fetch(origin + '/api/think', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
      body: JSON.stringify({ text }),
    });
  };
  try {
    const first = await send('First question');
    assert.equal(first.status, 201);
    await app.close();
    app = await startLocalServer({ root, statePath, port: 0, provider });
    const second = await send('Follow-up question');
    assert.equal(second.status, 201);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].slice(-3).map(x => x.content),
      ['First question', 'First factual response', 'Follow-up question']);
    const state = await (await fetch('http://127.0.0.1:' + app.port + '/api/state')).json();
    assert.equal(state.conversations.length, 2);
    assert.equal(state.receipts.filter(x => x.kind === 'model-response').length, 2);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
