import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { executeUniversalCloudTask, cloudOperationDigest } from '../src/universal-cloud-executor.mjs';

const NOW = '2026-11-17T23:00:00Z';
const baseTask = (overrides = {}) => ({
  provider: 'gitlab',
  operation: 'gitlab.branch.create',
  target: 'project:87884831:branch:ultron-task-1',
  idempotencyKey: 'cloud:gitlab:task-001',
  expectedStopVersion: 5,
  estimatedCostCents: 0,
  payload: { branch: 'ultron-task-1', ref: 'main' },
  ...overrides,
});
const baseGrant = (overrides = {}) => ({
  verified: true,
  actor: 'michaeljwilliams0123',
  provider: 'gitlab',
  operation: 'gitlab.branch.create',
  target: 'project:87884831:branch:ultron-task-1',
  expiresAt: '2026-11-17T23:10:00Z',
  maxPaidCents: 0,
  ...overrides,
});
const baseControl = (overrides = {}) => ({ paused: false, stopVersion: 5, ...overrides });
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
let nextNonce=1;
function signedTask(task,control=baseControl()) {
  const payload={
    toolName:task.operation,
    targetResource:'ultron:cloud:sha256:'+cloudOperationDigest(task,control.stopVersion),
    timestamp:Date.parse(NOW),
    nonce:'owner-approved-cloud-intent-'+String(nextNonce++).padStart(8,'0'),
  };
  const signature=sign('sha256',Buffer.from(JSON.stringify(payload)),{
    key:privateKey,dsaEncoding:'ieee-p1363',
  }).toString('base64url');
  return {
    ownerApproval:{payload,signature},trustedOwnerPublicKey:publicKey,
    approvalNonceStore:{async consume(){return true;}},
  };
}

function makeOutbox() {
  const rows = new Map();
  return {
    rows,
    async reserve({ idempotencyKey, requestDigest, fencingEpoch }) {
      if (rows.has(idempotencyKey)) {
        return { ok: false, existingStatus: rows.get(idempotencyKey).status, reason: 'duplicate-idempotency-key' };
      }
      rows.set(idempotencyKey, { status: 'reserved', requestDigest, fencingEpoch });
      return { ok: true, fencingEpoch };
    },
    async markSent({idempotencyKey,fencingEpoch}) {
      const r=rows.get(idempotencyKey);
      if(!r ||r.fencingEpoch!==fencingEpoch||r.status!=='reserved')return {ok:false};
      r.status='sent';
      return {ok:true};
    },
    async markReconcile({ idempotencyKey, reason }) {
      const r = rows.get(idempotencyKey);
      if (r) r.status = 'reconcile_required', r.reason = reason;
    },
    async markCompleted(receipt) {
      rows.set(receipt.idempotencyKey, { status: 'completed', receipt });
      return {verified:true,requestDigest:receipt.requestDigest,
        fencingEpoch:receipt.fencingEpoch};
    },
  };
}

test('universal cloud executor completes non-GitHub task with zero spend, independent readback, and trajectory', async () => {
  const outboxStore = makeOutbox();
  const task=baseTask(),control=baseControl();
  const observedDigest=cloudOperationDigest(task,control.stopVersion);
  const res = await executeUniversalCloudTask({
    task,
    ownerGrant: baseGrant(),
    runtimeControl: control,
    ...signedTask(task,control),
    outboxStore,
    submitProvider: async () => ({ ok: true, externalId: 'gl-ref-99' }),
    readbackProvider: async ({provider,operation,target,externalId}) => ({
      verified:true,origin:'provider-get',provider,operation,target,externalId,
      digest:observedDigest,httpStatus:200,paidCents:0,observedAt:NOW,
      sourceUrl:'https://gitlab.com/api/v4/projects/87884831/repository/branches/ultron-task-1',
    }),
    now: NOW,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'completed');
  assert.equal(res.receipt.costCents, 0);
  assert.equal(res.receipt.requestDigest, observedDigest);
  assert.equal(res.trajectory.schema, 'ultron.cloud-trajectory.v1');
  assert.equal(res.trajectory.independentlyObserved, true);

  // Replay with same idempotencyKey is denied without calling provider
  const replay = await executeUniversalCloudTask({
    task,
    ownerGrant: baseGrant(),
    runtimeControl: control,
    ...signedTask(task,control),
    outboxStore,
    submitProvider: async () => { throw Error('must not execute replay'); },
    readbackProvider: async () => { throw Error('must not readback replay'); },
    now: NOW,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.status, 'held');
});

test('zero-trust middleware blocks non-owner, expired grant, nonzero spend, and paused control', async () => {
  for (const grantPatch of [
    { verified: false },
    { actor: 'ultron-bot' },
    { provider: 'graph' },
    { expiresAt: NOW },
    { maxPaidCents: 100 },
  ]) {
    const r = await executeUniversalCloudTask({
      task: baseTask(),
      ownerGrant: baseGrant(grantPatch),
      runtimeControl: baseControl(),
      outboxStore: makeOutbox(),
      submitProvider: async () => { throw Error('must not submit'); },
      readbackProvider: async () => { throw Error('must not readback'); },
      now: NOW,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'held');
  }

  const paidTask = await executeUniversalCloudTask({
    task: baseTask({ estimatedCostCents: 1 }),
    ownerGrant: baseGrant(),
    runtimeControl: baseControl(),
    outboxStore: makeOutbox(),
    submitProvider: async () => { throw Error('must not submit'); },
    readbackProvider: async () => { throw Error('must not readback'); },
    now: NOW,
  });
  assert.equal(paidTask.ok, false);

  const paused = await executeUniversalCloudTask({
    task: baseTask(),
    ownerGrant: baseGrant(),
    runtimeControl: baseControl({ paused: true }),
    outboxStore: makeOutbox(),
    submitProvider: async () => { throw Error('must not submit'); },
    readbackProvider: async () => { throw Error('must not readback'); },
    now: NOW,
  });
  assert.equal(paused.ok, false);
});

test('static taint pre-filter blocks secret leakage and prototype-key injection before outbox reservation', async () => {
  const outboxStore = makeOutbox();
  const secretHit = await executeUniversalCloudTask({
    task: baseTask({ payload: { note: 'leak ghp_1234567890abcdef' } }),
    ownerGrant: baseGrant(),
    runtimeControl: baseControl(),
    outboxStore,
    submitProvider: async () => { throw Error('must not submit'); },
    readbackProvider: async () => { throw Error('must not readback'); },
    now: NOW,
  });
  assert.equal(secretHit.ok, false);
  assert.equal(secretHit.status, 'rejected');
  assert.match(secretHit.reason, /secret-pattern-detected/);
  assert.equal(outboxStore.rows.size, 0);

  const protoPayload = JSON.parse('{"__proto__":{"admin":true}}');
  const protoHit = await executeUniversalCloudTask({
    task: baseTask({ payload: protoPayload }),
    ownerGrant: baseGrant(),
    runtimeControl: baseControl(),
    outboxStore,
    submitProvider: async () => { throw Error('must not submit'); },
    readbackProvider: async () => { throw Error('must not readback'); },
    now: NOW,
  });
  assert.equal(protoHit.ok, false);
  assert.equal(protoHit.status, 'rejected');
  assert.match(protoHit.reason, /prototype-key-rejected/);
});

test('lost ACK or mismatched independent readback enters reconcile_required and blocks replay', async () => {
  const outboxStore = makeOutbox();
  const task=baseTask(),control=baseControl();
  const lostAck = await executeUniversalCloudTask({
    task,
    ownerGrant: baseGrant(),
    runtimeControl: control,
    ...signedTask(task,control),
    outboxStore,
    submitProvider: async () => { throw Error('network timeout'); },
    readbackProvider: async () => ({ verified: true }),
    now: NOW,
  });
  assert.equal(lostAck.ok, false);
  assert.equal(lostAck.status, 'reconcile_required');

  const retry = await executeUniversalCloudTask({
    task,
    ownerGrant: baseGrant(),
    runtimeControl: control,
    ...signedTask(task,control),
    outboxStore,
    submitProvider: async () => { throw Error('must not retry'); },
    readbackProvider: async () => ({ verified: true }),
    now: NOW,
  });
  assert.equal(retry.ok, false);
  assert.equal(retry.status, 'reconcile_required');
});
