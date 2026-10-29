import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workbenchCatalog,
  planWorkbenchOp,
  runWorkbenchOp,
  WORKBENCH_VERBS,
} from '../src/owner-workbench.mjs';

test('catalog lists github and internet verbs', () => {
  const c = workbenchCatalog();
  assert.ok(c.verbs.includes('github.issue.comment'));
  assert.ok(c.verbs.includes('internet.fetch'));
  assert.ok(WORKBENCH_VERBS.length >= 10);
});

test('plan requires autonomy or workbench flag', () => {
  const denied = planWorkbenchOp({ verb: 'github.issue.list', env: {} });
  assert.equal(denied.ok, false);
  const ok = planWorkbenchOp({ verb: 'github.issue.list', env: { OWNER_MODE: '1' } });
  assert.equal(ok.ok, true);
});

test('https only for fetch', () => {
  const bad = planWorkbenchOp({ verb: 'internet.fetch', url: 'http://example.com', env: { ULTRON_WORKBENCH: '1' } });
  assert.equal(bad.ok, false);
  const good = planWorkbenchOp({ verb: 'internet.fetch', url: 'https://example.com/x', env: { ULTRON_WORKBENCH: '1' } });
  assert.equal(good.ok, true);
});

test('dispatch rejects pathy workflow names', () => {
  const bad = planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: '../evil.yml', env: { OWNER_MODE: '1' } });
  assert.equal(bad.ok, false);
  const good = planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: 'verify.yml', env: { OWNER_MODE: '1' } });
  assert.equal(good.ok, true);
});

test('runWorkbenchOp uses injected github adapter', async () => {
  const out = await runWorkbenchOp(
    { verb: 'github.issue.read', number: 42, env: { OWNER_MODE: '1' } },
    { github: { request: async (verb, args) => ({ verb, args, title: 'demo' }) } },
  );
  assert.equal(out.ok, true);
  assert.equal(out.result.title, 'demo');
  assert.match(out.fingerprint, /^[a-f0-9]{64}$/);
});
