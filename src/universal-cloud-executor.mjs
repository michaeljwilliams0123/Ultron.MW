import { createHash } from 'node:crypto';
import { verifyCryptographicApproval } from './security/crypto_auth.mjs';
// Code-source AST inspection is loaded only when required. A missing parser
// fails that operation closed, without breaking non-code provider adapters.

const PROVIDERS = new Set(['gitlab', 'graph', 'huggingface', 'composio', 'hatchable-browser']);
const OWNER_ACTOR = 'michaeljwilliams0123';
const IDEMPOTENCY_KEY = /^[a-z0-9][a-z0-9:_-]{7,127}$/;
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{12,}/,
  /github_pat_[A-Za-z0-9_]{12,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /hf_[A-Za-z0-9]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
];

function stableJson(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>
    JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
}
function canonicalDigest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

/** Stable exact-intent digest: caller must not supply a digest to be trusted. */
export function cloudOperationDigest(task, stopVersion) {
  return canonicalDigest({
    provider:task.provider,operation:task.operation,target:task.target,
    idempotencyKey:task.idempotencyKey,payload:task.payload??{},
    estimatedCostCents:task.estimatedCostCents,stopVersion,
  });
}

function scanPayloadForTaint(value, depth = 0) {
  if (depth > 8) return 'payload-depth-exceeded';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite-number';
    return null;
  }
  if (typeof value === 'string') {
    if (value.length > 16384) return 'payload-string-oversized';
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) return 'secret-pattern-detected';
    }
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) return 'payload-array-oversized';
    for (const item of value) {
      const hit = scanPayloadForTaint(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 50) return 'payload-object-oversized';
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return 'prototype-key-rejected';
      }
      const hit = scanPayloadForTaint(value[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  return 'unsupported-payload-type';
}

/**
 * Universal non-GitHub cloud task executor:
 * 1. Zero-trust owner grant + $0 spend ceiling + runtime stop check
 * 2. Deterministic static taint/secret pre-filter
 * 3. Fenced outbox reservation (no-replay) + lost-ACK reconciliation
 * 4. Independent provider readback + trajectory fingerprint for Reef learning
 */
export async function executeUniversalCloudTask({
  task,
  ownerGrant,
  ownerApproval,
  trustedOwnerPublicKey,
  approvalNonceStore,
  runtimeControl,
  outboxStore,
  submitProvider,
  readbackProvider,
  now = new Date().toISOString(),
} = {}) {
  const instant = Date.parse(now);
  if (!Number.isFinite(instant)) {
    return { ok: false, status: 'held', reason: 'invalid-clock' };
  }
  if (!task || typeof task !== 'object' || Array.isArray(task) ||
      !PROVIDERS.has(task.provider) ||
      typeof task.operation !== 'string' || !task.operation.trim() ||
      typeof task.target !== 'string' || !task.target.trim() ||
      !IDEMPOTENCY_KEY.test(task.idempotencyKey || '')) {
    return { ok: false, status: 'held', reason: 'invalid-cloud-task' };
  }

  // Step 3: Zero-trust authority & $0 spend ceiling
  const grantExpires = Date.parse(ownerGrant?.expiresAt || '');
  if (!ownerGrant ||
      ownerGrant.actor !== OWNER_ACTOR ||
      ownerGrant.provider !== task.provider ||
      ownerGrant.operation !== task.operation ||
      ownerGrant.target !== task.target ||
      !Number.isFinite(grantExpires) || grantExpires <= instant ||
      ownerGrant.maxPaidCents !== 0 ||
      task.estimatedCostCents !== 0) {
    return { ok: false, status: 'held', reason: 'owner-grant-or-zero-spend-denied' };
  }
  if (!runtimeControl || runtimeControl.paused !== false ||
      !Number.isSafeInteger(runtimeControl.stopVersion) || runtimeControl.stopVersion < 1 ||
      runtimeControl.stopVersion !== task.expectedStopVersion) {
    return { ok: false, status: 'held', reason: 'runtime-control-paused-or-stale' };
  }

  // Step 4: Deterministic static taint & secret pre-filter
  const taint = scanPayloadForTaint(task.payload ?? {});
  if (taint) {
    return { ok: false, status: 'rejected', reason: 'static-taint-blocked:' + taint };
  }

  // Code-bearing payloads require the existing AST analyzer. Its zero-flow
  // result is advisory, not authorization; any uncertainty fails this write.
  if (typeof task.payload?.sourceCode === 'string') {
    let analysis;
    try {
      const {analyzePayloadAST}=await import('./security/ast_taint_analyzer.mjs');
      analysis=analyzePayloadAST(task.payload.sourceCode);
    } catch {
      return {ok:false,status:'rejected',reason:'ast-scanner-unavailable'};
    }
    if (analysis.status !== 'no-known-flow' ||
        analysis.unknowns.length || analysis.violations.length)
      return { ok:false,status:'rejected',reason:'ast-taint-or-unknown-flow' };
  }

  const requestDigest = cloudOperationDigest(task,runtimeControl.stopVersion);
  // Existing trusted verifier checks the pinned owner P-256 signature and
  // consumes a one-time nonce atomically in the durable PostgreSQL ledger.
  // Never take trustedOwnerPublicKey or approvalNonceStore from a client body.
  const signed = await verifyCryptographicApproval(
    ownerApproval?.payload,ownerApproval?.signature,trustedOwnerPublicKey,{
      algorithm:'ecdsa-p256-sha256',
      now:instant,
      nonceStore:approvalNonceStore,
      expectedToolName:task.operation,
      expectedTargetResource:'ultron:cloud:sha256:'+requestDigest,
    });
  if(!signed)
    return {ok:false,status:'held',reason:'exact-intent-owner-signature-required'};

  // Step 1: Fenced transactional outbox reservation
  if (!outboxStore || typeof outboxStore.reserve !== 'function' ||
      typeof outboxStore.markSent !== 'function' ||
      typeof outboxStore.markReconcile !== 'function' ||
      typeof outboxStore.markCompleted !== 'function' ||
      typeof submitProvider !== 'function' ||
      typeof readbackProvider !== 'function') {
    return { ok: false, status: 'held', reason: 'outbox-store-unavailable' };
  }

  const reservation = await outboxStore.reserve({
    idempotencyKey: task.idempotencyKey,
    requestDigest,
    fencingEpoch: runtimeControl.stopVersion,
  });
  if (!reservation || reservation.ok !== true ||
      !Number.isSafeInteger(reservation.fencingEpoch) ||
      reservation.fencingEpoch < 1) {
    return {
      ok: false,
      status: reservation?.existingStatus === 'reconcile_required' ? 'reconcile_required' : 'held',
      reason: reservation?.reason || 'outbox-reservation-denied',
    };
  }

  // The provider POST cannot start until durable sent-state compare-and-set.
  // A stopVersion is not a lease generation; reserve must return a DB-fenced
  // monotonically allocated generation independently of the stopVersion.
  const sent=await outboxStore.markSent({
    idempotencyKey:task.idempotencyKey,requestDigest,
    fencingEpoch:reservation.fencingEpoch,
  });
  if(sent?.ok!==true)
    return {ok:false,status:'held',reason:'durable-send-fence-denied'};

  // Step 1 + 3: Execute provider call and require independent readback
  let submitResult;
  try {
    submitResult = await submitProvider({
      provider: task.provider,
      operation: task.operation,
      target: task.target,
      payload: task.payload ?? {},
      idempotencyKey: task.idempotencyKey,
      fencingEpoch: reservation.fencingEpoch,
    });
  } catch {
    await outboxStore.markReconcile({
      idempotencyKey: task.idempotencyKey,
      fencingEpoch: reservation.fencingEpoch,
      reason: 'provider-submit-uncertain',
    });
    return { ok: false, status: 'reconcile_required', reason: 'provider-submit-uncertain' };
  }

  if (!submitResult || submitResult.ok !== true) {
    await outboxStore.markReconcile({
      idempotencyKey: task.idempotencyKey,
      fencingEpoch: reservation.fencingEpoch,
      reason: 'provider-ack-missing-or-denied',
    });
    return { ok: false, status: 'reconcile_required', reason: 'provider-ack-missing-or-denied' };
  }

  let readback;
  try {
    readback = await readbackProvider({
      provider: task.provider,
      operation: task.operation,
      target: task.target,
      externalId: submitResult.externalId,
      idempotencyKey:task.idempotencyKey,
    });
  } catch {
    await outboxStore.markReconcile({
      idempotencyKey: task.idempotencyKey,
      fencingEpoch: reservation.fencingEpoch,
      reason: 'independent-readback-unavailable',
    });
    return { ok: false, status: 'reconcile_required', reason: 'independent-readback-unavailable' };
  }

  // No self-echo of expectedDigest is passed to the observation adapter.
  // Trusted provider adapter must supply fresh GET provenance and a separate
  // postcondition observation. A boolean alone never proves completion.
  const observedAt=Date.parse(readback?.observedAt||'');
  if (!readback || readback.verified !== true ||
      readback.origin !== 'provider-get' ||
      readback.provider !== task.provider ||
      readback.operation !== task.operation ||
      readback.target !== task.target ||
      readback.externalId !== submitResult.externalId ||
      typeof readback.digest !== 'string' ||
      readback.digest !== requestDigest ||
      readback.httpStatus !== 200 ||
      !Number.isFinite(observedAt) || observedAt < instant ||
      readback.paidCents !== 0 ||
      typeof readback.sourceUrl !== 'string' ||
      !readback.sourceUrl.startsWith('https://')) {
    await outboxStore.markReconcile({
      idempotencyKey: task.idempotencyKey,
      fencingEpoch: reservation.fencingEpoch,
      reason: 'independent-readback-mismatch',
    });
    return { ok: false, status: 'reconcile_required', reason: 'independent-readback-mismatch' };
  }

  const receipt = Object.freeze({
    idempotencyKey: task.idempotencyKey,
    provider: task.provider,
    operation: task.operation,
    target: task.target,
    externalId: submitResult.externalId,
    requestDigest,
    fencingEpoch: reservation.fencingEpoch,
    costCents: 0,
    verifiedAt: new Date(instant).toISOString(),
  });
  const completion=await outboxStore.markCompleted(receipt);
  if(completion?.verified!==true ||
     completion.requestDigest!==requestDigest ||
     completion.fencingEpoch!==reservation.fencingEpoch)
    return {ok:false,status:'reconcile_required',reason:'terminal-db-readback-unverified'};

  // Step 4: Trajectory fingerprint for Reef-gated skill distillation
  const trajectory = Object.freeze({
    schema: 'ultron.cloud-trajectory.v1',
    fingerprint: canonicalDigest(receipt),
    provider: task.provider,
    operation: task.operation,
    outcome: 'succeeded',
    independentlyObserved: true,
    costUsd: 0,
  });

  return { ok: true, status: 'completed', receipt, trajectory };
}
