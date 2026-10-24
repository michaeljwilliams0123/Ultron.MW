import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginInteroperability, PLUGIN_PROVIDERS }
  from '../src/plugin-interoperability.mjs';
import { createCapabilityBroker } from '../src/capability-bindings.mjs';

const now = Date.parse('2026-10-24T01:00:00.000Z');
function fixture({ scopes = ['repo.read', 'pr.write'], authorize = async () => false } = {}) {
  let calls = 0;
  const broker = createCapabilityBroker({
    clock: () => new Date(now).toISOString(), authorize,
  });
  broker.bind({
    id: 'github-owner', provider: 'github', runtime: 'cloud-api',
    actorRef: 'github:owner-one', authMethod: 'app-token',
    origins: ['https://api.github.com'],
    operations: [
      { name: 'repo.read', effect: 'read', scope: 'repo.read' },
      { name: 'pr.write', effect: 'write', scope: 'pr.write' },
    ],
    expiresAt: '2026-10-25T00:00:00Z', maxCostCents: 0,
    credentialRef: 'env:ULTRON_GITHUB_APP_TOKEN',
  }, {
    async health() {
      return { status: 'ready', actorRef: 'github:owner-one', grantedScopes: scopes };
    },
    async execute() { calls++; return { created: true, private: 'do-not-persist' }; },
    async observe() { return { verified: true, source: 'provider-readback' }; },
    async unbind() { return { revoked: true }; },
  });
  return {
    broker, calls: () => calls,
    router: (offset = 0) => createPluginInteroperability({
      broker, bindingIds: ['github-owner'], clock: () => now + offset,
    }),
  };
}

test('all seven requested plugin surfaces and Mahoraga are declared, never presumed connected', () => {
  assert.deepEqual(PLUGIN_PROVIDERS.map(x => x.id).sort(), [
    'browser-use', 'caveman', 'compound-engineering', 'descope',
    'desktop-commander', 'github', 'hugging-face', 'mahoraga',
  ]);
  const view = fixture().router().inventory();
  assert.equal(view.find(x => x.provider === 'github').readiness, 'not-probed');
  assert.equal(view.find(x => x.provider === 'caveman').readiness, 'skill-only');
  assert.equal(view.find(x => x.provider === 'mahoraga').readiness, 'not-probed');
});
test('pure skills cannot impersonate authenticated execution adapters', async () => {
  const f = fixture();
  const result = await f.router().execute({
    provider: 'compound-engineering', operation: 'code.implement',
    effect: 'write',
  });
  assert.equal(result.status, 'skill-only');
  assert.equal(f.calls(), 0);
});
test('unbound operations, effects and providers are refused', async () => {
  const f = fixture();
  await f.broker.health('github-owner');
  for (const request of [
    { provider: 'github', operation: 'pr.merge', effect: 'write' },
    { provider: 'github', operation: 'repo.read', effect: 'write' },
    { provider: 'browser-use', operation: 'browser.act', effect: 'write' },
    { provider: 'descope', operation: 'identity.write', effect: 'write' },
    { provider: 'unknown', operation: 'repo.read', effect: 'read' },
  ]) {
    const result = await f.router().execute(request);
    assert.notEqual(result.status, 'completed');
  }
  assert.equal(f.calls(), 0);
});
test('live matching health allows exact read operation with postcondition receipt', async () => {
  const f = fixture();
  await f.broker.health('github-owner');
  const api = f.router();
  assert.equal(api.inventory().find(x => x.provider === 'github').readiness, 'health-probed');
  const request = {
    provider: 'github', operation: 'repo.read', effect: 'read',
    idempotencyKey: 'read:plugin12345', estimatedCostCents: 0,
    input: { name: 'Ultron.MW' }, expected: { created: true },
  };
  const one = await api.execute(request);
  const two = await api.execute(request);
  assert.equal(one.status, 'completed');
  assert.equal(two.resumed, true);
  assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(one).includes('do-not-persist'), false);
});
test('authorized provider write still requires independent broker approval', async () => {
  const f = fixture();
  await f.broker.health('github-owner');
  const result = await f.router().execute({
    provider: 'github', operation: 'pr.write', effect: 'write',
    idempotencyKey: 'write:plugin1234', estimatedCostCents: 0,
    input: {}, expected: { created: true },
  });
  assert.equal(result.status, 'approval-required');
  assert.equal(f.calls(), 0);
});
test('partial scopes, stale health, and unbudgeted costs fail closed', async () => {
  const f = fixture({ scopes: ['repo.read'] });
  await f.broker.health('github-owner');
  assert.equal(f.router().select({
    provider: 'github', operation: 'repo.read', effect: 'read',
  }).status, 'not-ready');
  assert.equal(f.router().select({
    provider: 'github', operation: 'pr.write', effect: 'write',
    estimatedCostCents: 1,
  }).status, 'not-ready');
  const g = fixture();
  await g.broker.health('github-owner');
  assert.equal(g.router(600000).select({
    provider: 'github', operation: 'repo.read', effect: 'read',
  }).status, 'not-ready');
  assert.throws(() => createPluginInteroperability({
    broker: g.broker, bindingIds: ['github-owner', 'github-owner'],
  }), /Invalid/);
});
