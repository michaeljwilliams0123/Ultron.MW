import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityBroker } from '../src/capability-bindings.mjs';
import { createPluginInteroperability } from '../src/plugin-interoperability.mjs';
import { createMahoragaControlAdapter, MAHORAGA_REPOSITORY }
  from '../src/mahoraga-control.mjs';

const MAIN = 'a'.repeat(40), BRANCH = 'b'.repeat(40);
const NOW = Date.parse('2026-10-24T05:00:00Z');
function fixture({ authorize = async () => true, main = MAIN,
  repo = MAHORAGA_REPOSITORY, uncertainDispatch = false } = {}) {
  const calls = [], issues = [], runs = [];
  let currentMain = main;
  const operator = { async request({ method = 'GET', path, permission, body }) {
    calls.push({ method, path, permission, body });
    if (path === '/') return { id: 123, full_name: repo, private: true,
      default_branch: 'main' };
    if (path === '/git/ref/heads/main') return { object: { sha: currentMain } };
    if (path === '/git/ref/heads/mahoraga/feature')
      return { object: { sha: BRANCH } };
    if (path.startsWith('/issues?')) return path.includes('per_page=1') ? [] : issues;
    if (/^\/issues\/[0-9]+$/.test(path))
      return issues.find(item => item.number === Number(path.split('/').at(-1)));
    if (path === '/issues' && method === 'POST') {
      const item = { number: issues.length + 1, ...body };
      issues.push(item);
      return item;
    }
    if (path === '/actions/workflows/verify.yml') return { id: 9 };
    if (path.startsWith('/actions/workflows/verify.yml/runs?'))
      return { workflow_runs: runs };
    if (path === '/actions/workflows/verify.yml/dispatches') {
      if (uncertainDispatch) throw Error('write outcome unknown');
      runs.push({ id: 91, head_sha: BRANCH, head_branch: 'mahoraga/feature',
        event: 'workflow_dispatch', path: '.github/workflows/verify.yml' });
      return null;
    }
    if (path === '/actions/runs/91') return runs[0];
    throw Error('Unexpected Mahoraga API path: ' + path);
  } };
  const broker = createCapabilityBroker({
    authorize, clock: () => new Date(NOW).toISOString(),
  });
  broker.bind({ id: 'mahoraga-app', provider: 'mahoraga',
    runtime: 'cloud-api', actorRef: 'github-app:mahoraga',
    authMethod: 'app-token', origins: ['https://api.github.com'],
    operations: [
      { name: 'mahoraga.issue.create', effect: 'write',
        scope: 'mahoraga.issue.create' },
      { name: 'mahoraga.workflow.dispatch', effect: 'write',
        scope: 'mahoraga.workflow.dispatch' },
    ], expiresAt: '2026-10-25T00:00:00Z', maxCostCents: 0,
    credentialRef: 'env:ULTRON_MAHORAGA_GITHUB_APP_KEY',
  }, createMahoragaControlAdapter({ operator, repositoryId: 123 }));
  const router = createPluginInteroperability({ broker,
    bindingIds: ['mahoraga-app'], clock: () => NOW });
  return { broker, router, calls, issues, runs,
    moveMain(sha) { currentMain = sha; } };
}

const issue = key => ({ provider: 'mahoraga',
  operation: 'mahoraga.issue.create', effect: 'write',
  idempotencyKey: key, estimatedCostCents: 0,
  input: { title: 'Bounded control request', body: 'Inspect one failure.',
    expectedMainSha: MAIN }, expected: { kind: 'issue' } });
const dispatch = key => ({ provider: 'mahoraga',
  operation: 'mahoraga.workflow.dispatch', effect: 'write',
  idempotencyKey: key, estimatedCostCents: 0,
  input: { ref: 'mahoraga/feature', expectedHeadSha: BRANCH },
  expected: { kind: 'verify' } });

test('Mahoraga write route needs a real repository and both installed grants', async () => {
  const f = fixture();
  assert.equal(f.router.select(issue('control:one')).status, 'not-ready');
  await f.broker.health('mahoraga-app');
  assert.equal(f.router.select(issue('control:one')).status, 'ready');
  assert.ok(f.calls.some(call => call.permission === 'issues:write'));
  assert.ok(f.calls.some(call => call.permission === 'actions:write'));
  await assert.rejects(() => fixture({ repo: 'other/repo' })
    .broker.health('mahoraga-app'), /identity mismatch/);
});

test('broker refusal prevents Mahoraga mutations', async () => {
  const f = fixture({ authorize: async () => false });
  await f.broker.health('mahoraga-app');
  assert.equal((await f.router.execute(issue('control:denied'))).status,
    'approval-required');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('issue creation has exact-main, marker and independent readback', async () => {
  const f = fixture();
  await f.broker.health('mahoraga-app');
  const first = await f.router.execute(issue('control:issue-one'));
  assert.equal(first.status, 'completed');
  assert.equal(f.issues.length, 1);
  assert.match(f.issues[0].body, /ULTRON_MAHORAGA_CONTROL_V1 control:issue-one/);
  const replay = await f.router.execute(issue('control:issue-one'));
  assert.equal(replay.resumed, true);
  assert.equal(f.calls.filter(call => call.path === '/issues' &&
    call.method === 'POST').length, 1);
  f.moveMain('c'.repeat(40));
  assert.equal((await f.router.execute(issue('control:issue-two'))).status,
    'reconcile-required');
  assert.equal(f.issues.length, 1);
});

test('workflow dispatch checks exact branch and verifies its run', async () => {
  const f = fixture();
  await f.broker.health('mahoraga-app');
  const receipt = await f.router.execute(dispatch('control:verify-one'));
  assert.equal(receipt.status, 'completed');
  assert.equal(f.runs.length, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith('/dispatches') &&
    call.method === 'POST').length, 1);
});

test('uncertain dispatch is never replayed with the same key', async () => {
  const f = fixture({ uncertainDispatch: true });
  await f.broker.health('mahoraga-app');
  assert.equal((await f.router.execute(dispatch('control:uncertain'))).status,
    'reconcile-required');
  assert.equal((await f.router.execute(dispatch('control:uncertain'))).status,
    'reconcile-required');
  assert.equal(f.calls.filter(call => call.path.endsWith('/dispatches') &&
    call.method === 'POST').length, 1);
});
