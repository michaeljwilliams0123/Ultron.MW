import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityBroker, validateCapabilityBinding }
  from '../src/capability-bindings.mjs';

const now = '2026-10-21T20:00:00.000Z';
const manifest = (overrides = {}) => ({
  id: 'github-owner', provider: 'github', runtime: 'cloud-api',
  actorRef: 'github:owner-308995719', authMethod: 'app-token',
  origins: ['https://api.github.com'],
  operations: [
    { name: 'repo.read', effect: 'read', scope: 'contents.read' },
    { name: 'issue.write', effect: 'write', scope: 'issues.write' },
  ],
  expiresAt: '2026-10-22T20:00:00Z', maxCostCents: 0,
  credentialRef: 'env:ULTRON_GITHUB_APP_TOKEN', ...overrides,
});
function adapter(overrides = {}) {
  let executions = 0;
  return {
    async health() { return { status: 'ready', actorRef: 'github:owner-308995719',
      grantedScopes: ['contents.read', 'issues.write'] }; },
    async execute() { executions++; return { status: 200, privateValue: 'not-persisted' }; },
    async observe() { return { verified: true, source: 'provider-readback' }; },
    async unbind() { return { revoked: true }; },
    get executions() { return executions; }, ...overrides,
  };
}

test('binding manifest is versioned, bounded and never returns credential values', () => {
  const value = validateCapabilityBinding(manifest());
  assert.equal(value.schema, 'ultron.binding.v1');
  assert.equal(value.credentialRef, 'env:ULTRON_GITHUB_APP_TOKEN');
  assert.throws(() => validateCapabilityBinding(manifest({ credentialRef: 'ghp_secret' })),
    /Invalid/);
  assert.throws(() => validateCapabilityBinding(manifest({
    origins: ['http://api.github.com'],
  })), /Invalid/);
});

test('health requires matching provider identity and every declared scope', async () => {
  const broker = createCapabilityBroker({ clock: () => now });
  broker.bind(manifest(), adapter());
  assert.equal((await broker.health('github-owner')).readiness, 'ready');
  const partial = createCapabilityBroker({ clock: () => now });
  partial.bind(manifest(), adapter({
    health: async () => ({ status: 'ready', actorRef: 'github:someone-else',
      grantedScopes: ['contents.read'] }),
  }));
  assert.equal((await partial.health('github-owner')).readiness, 'partial');
  await assert.rejects(partial.execute('github-owner', {
    operation: 'repo.read', idempotencyKey: 'read:12345678',
    estimatedCostCents: 0, input: {}, expected: {},
  }), /not ready/);
});

test('read operation completes once and exact retry returns its receipt', async () => {
  const target = adapter();
  const broker = createCapabilityBroker({ clock: () => now });
  broker.bind(manifest(), target);
  await broker.health('github-owner');
  const request = { operation: 'repo.read', idempotencyKey: 'read:12345678',
    estimatedCostCents: 0, input: { repository: 'Ultron.MW' },
    expected: { status: 200 } };
  const first = await broker.execute('github-owner', request);
  const second = await broker.execute('github-owner', request);
  assert.equal(first.status, 'completed');
  assert.equal(second.resumed, true);
  assert.equal(target.executions, 1);
  assert.equal(JSON.stringify(first).includes('not-persisted'), false);
  await assert.rejects(broker.execute('github-owner', {
    ...request, input: { repository: 'other' },
  }), /Idempotency key/);
});

test('write operation requires independent approval before provider dispatch', async () => {
  const target = adapter();
  const denied = createCapabilityBroker({ clock: () => now });
  denied.bind(manifest(), target);
  await denied.health('github-owner');
  assert.equal((await denied.execute('github-owner', {
    operation: 'issue.write', idempotencyKey: 'write:12345678',
    estimatedCostCents: 0,
    input: { title: 'test' }, expected: { issueCreated: true },
  })).status, 'approval-required');
  assert.equal(target.executions, 0);
});

test('unverified provider outcome is never replayed automatically', async () => {
  const target = adapter({ observe: async () => ({ verified: false }) });
  const broker = createCapabilityBroker({ clock: () => now });
  broker.bind(manifest(), target);
  await broker.health('github-owner');
  const request = { operation: 'repo.read', idempotencyKey: 'read:uncertain1',
    estimatedCostCents: 0, input: {}, expected: { status: 200 } };
  assert.equal((await broker.execute('github-owner', request)).status, 'reconcile-required');
  assert.equal((await broker.execute('github-owner', request)).status, 'reconcile-required');
  assert.equal(target.executions, 1);
});

test('expired, revoked and cross-provider authority fail closed', async () => {
  const expired = createCapabilityBroker({ clock: () => now });
  expired.bind(manifest({ expiresAt: '2026-10-21T19:59:59Z' }), adapter());
  assert.equal(expired.status('github-owner').readiness, 'expired');
  await assert.rejects(expired.health('github-owner'), /expired/);

  const revoked = createCapabilityBroker({ clock: () => now });
  revoked.bind(manifest(), adapter({ health: async () => ({ status: 'revoked',
    actorRef: 'github:owner-308995719', grantedScopes: [] }) }));
  assert.equal((await revoked.health('github-owner')).readiness, 'revoked');

  const cloudflare = createCapabilityBroker({ clock: () => now });
  cloudflare.bind(manifest({ id: 'cloudflare-owner', provider: 'cloudflare',
    actorRef: 'cloudflare:profile-cd6dd77b',
    origins: ['https://api.cloudflare.com'],
    credentialRef: 'env:ULTRON_CLOUDFLARE_API_TOKEN',
    operations: [{ name: 'workers.read', effect: 'read', scope: 'workers.read' }],
  }), adapter({ health: async () => ({ status: 'ready',
    actorRef: 'cloudflare:profile-cd6dd77b', grantedScopes: ['workers.read'] }) }));
  await cloudflare.health('cloudflare-owner');
  await assert.rejects(cloudflare.execute('cloudflare-owner', {
    operation: 'repo.read', idempotencyKey: 'cross:12345678', input: {}, expected: {},
    estimatedCostCents: 0,
  }), /not admitted/);
});

test('every operation enforces the declared cost ceiling before dispatch', async () => {
  const target = adapter();
  const broker = createCapabilityBroker({ clock: () => now });
  broker.bind(manifest(), target);
  await broker.health('github-owner');
  await assert.rejects(broker.execute('github-owner', {
    operation: 'repo.read', idempotencyKey: 'cost:12345678',
    estimatedCostCents: 1, input: {}, expected: {},
  }), /Invalid capability request/);
  assert.equal(target.executions, 0);
});

test('unbind requires approval and provider-confirmed revocation', async () => {
  const target = adapter();
  const denied = createCapabilityBroker({ clock: () => now });
  denied.bind(manifest(), target);
  assert.equal((await denied.unbind('github-owner')).status, 'approval-required');
  assert.equal(denied.status('github-owner').readiness, 'not-probed');

  const allowed = createCapabilityBroker({ clock: () => now,
    authorize: async context => context.operation === 'unbind' });
  allowed.bind(manifest(), target);
  assert.equal((await allowed.unbind('github-owner')).status, 'unbound');
  assert.throws(() => allowed.status('github-owner'), /Unknown/);
});


test('two same-key writes reserve once before asynchronous owner authorization', async () => {
 let releaseApproval;
 const gate=new Promise(resolve=>{releaseApproval=resolve;});
 let approvals=0;
 const target=adapter();
 const broker=createCapabilityBroker({clock:()=>now,authorize:async()=>{
   approvals++;await gate;return true;
 }});
 broker.bind(manifest(),target);
 await broker.health('github-owner');
 const req={operation:'issue.write',idempotencyKey:'write:concurrent1',
   estimatedCostCents:0,input:{title:'Bounded test'},expected:{issueCreated:true}};
 const first=broker.execute('github-owner',req);
 const second=broker.execute('github-owner',req);
 releaseApproval();
 await Promise.all([first,second]);
 assert.equal(approvals,1,'the same action cannot request approval twice in parallel');
 assert.equal(target.executions,1,'the same action must have at most one side effect');
});

test('approval cannot dispatch after binding expires while awaiting authorization', async () => {
 let current=now;
 const target=adapter();
 const broker=createCapabilityBroker({clock:()=>current,authorize:async()=>{
   current='2026-10-23T20:00:00.000Z';return true;
 }});
 broker.bind(manifest(),target);
 await broker.health('github-owner');
 await assert.rejects(broker.execute('github-owner',{
   operation:'issue.write',idempotencyKey:'write:expires01',
   estimatedCostCents:0,input:{title:'Expires'},expected:{issueCreated:true},
 }),/expired|ready|revoked/i);
 assert.equal(target.executions,0,'expired authority must never dispatch');
});

test('approval binds immutable request content despite caller mutation', async () => {
 const seen=[];
 const target=adapter({execute:async ({input})=>{
   seen.push(input.title);return {status:201};
 }});
 const request={operation:'issue.write',idempotencyKey:'write:mutation1',
   estimatedCostCents:0,input:{title:'Owner-approved title'},expected:{issueCreated:true}};
 const broker=createCapabilityBroker({clock:()=>now,authorize:async context=>{
   assert.match(context.requestFingerprint||'',/^[a-f0-9]{64}$/);
   request.input.title='Changed after approval request';
   return true;
 }});
 broker.bind(manifest(),target);
 await broker.health('github-owner');
 assert.equal((await broker.execute('github-owner',request)).status,'completed');
 assert.deepEqual(seen,['Owner-approved title'],
   'dispatched operation must be identical to the authorization fingerprint');
});
