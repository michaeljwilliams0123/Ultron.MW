import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workbenchCatalog,
  planWorkbenchOp,
  runWorkbenchOp,
  WORKBENCH_VERBS,
  isBlockedFetchHost,
  assertSafeHttpsUrl,
  ALLOWED_DISPATCH_WORKFLOWS,
} from '../src/owner-workbench.mjs';

test('catalog lists github and internet verbs', () => {
  const c = workbenchCatalog();
  assert.ok(c.verbs.includes('github.issue.comment'));
  assert.ok(c.verbs.includes('internet.fetch'));
  assert.ok(WORKBENCH_VERBS.length >= 10);
  assert.ok(c.allowedDispatchWorkflows.includes('verify.yml'));
});

test('plan requires autonomy or workbench flag', () => {
  const denied = planWorkbenchOp({ verb: 'github.issue.list', env: {} });
  assert.equal(denied.ok, false);
  const ok = planWorkbenchOp({ verb: 'github.issue.list', env: { OWNER_MODE: '1' } });
  assert.equal(ok.ok, true);
});

test('https only and private host deny for fetch', () => {
  assert.equal(planWorkbenchOp({ verb: 'internet.fetch', url: 'http://example.com', env: { ULTRON_WORKBENCH: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'internet.fetch', url: 'https://127.0.0.1/', env: { ULTRON_WORKBENCH: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'internet.fetch', url: 'https://169.254.169.254/latest', env: { ULTRON_WORKBENCH: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'internet.fetch', url: 'https://localhost/x', env: { ULTRON_WORKBENCH: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'internet.fetch', url: 'https://example.com/x', env: { ULTRON_WORKBENCH: '1' } }).ok, true);
  assert.equal(isBlockedFetchHost('10.0.0.1'), true);
  assert.equal(assertSafeHttpsUrl('https://example.com').ok, true);
});

test('dispatch allowlist workflow and ref', () => {
  assert.equal(planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: '../evil.yml', env: { OWNER_MODE: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: 'not-real.yml', env: { OWNER_MODE: '1' } }).ok, false);
  assert.equal(planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: 'verify.yml', ref: 'evil-branch', env: { OWNER_MODE: '1' } }).ok, false);
  const good = planWorkbenchOp({ verb: 'github.actions.dispatch', workflow: 'verify.yml', ref: 'main', env: { OWNER_MODE: '1' } });
  assert.equal(good.ok, true);
  assert.deepEqual(good.args.inputs, {});
  assert.ok(ALLOWED_DISPATCH_WORKFLOWS.includes('verify.yml'));
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

test('fetch uses redirect error and streams via adapter', async () => {
  const calls = [];
  const out = await runWorkbenchOp(
    { verb: 'internet.fetch', url: 'https://example.com/page', env: { ULTRON_WORKBENCH: '1' } },
    {
      fetch: async (url, opts) => {
        calls.push({ url, opts });
        return {
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => Buffer.from('hello world'),
        };
      },
    },
  );
  assert.equal(out.ok, true);
  assert.equal(calls[0].opts.redirect, 'error');
  assert.match(out.result.textPreview, /hello/);
});
