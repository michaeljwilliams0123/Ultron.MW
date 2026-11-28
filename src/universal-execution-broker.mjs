import { createHash, randomUUID } from 'node:crypto';

export const EXECUTION_STATES = Object.freeze([
  'RECEIVED',
  'PLANNED',
  'AUTHORIZED',
  'CLAIMED',
  'EXECUTING',
  'VERIFYING',
  'COMPLETED',
  'HELD',
  'FAILED',
  'REVOKED',
  'RECONCILE_REQUIRED',
  'COMPENSATED',
  'CANCELLED',
]);

const TERMINAL_STATES = new Set(['COMPLETED', 'COMPENSATED', 'CANCELLED']);
const EFFECTS = new Set(['read', 'write', 'destructive']);
const ID_RE = /^[a-z0-9][a-z0-9_.:-]{2,127}$/i;
const sha256 = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const isPlainData = v => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = Object.getOwnPropertyDescriptors(v);
  return Reflect.ownKeys(d).every(k => typeof k === 'string' && d[k]?.enumerable && Object.hasOwn(d[k], 'value'));
};

export function validateOperationContract(contract) {
  if (!isPlainData(contract) ||
      !ID_RE.test(contract.provider || '') ||
      !ID_RE.test(contract.executionMethod || '') ||
      !ID_RE.test(contract.actorRef || '') ||
      !ID_RE.test(contract.resourceId || '') ||
      !ID_RE.test(contract.operation || '') ||
      !EFFECTS.has(contract.effect) ||
      !ID_RE.test(contract.scope || '') ||
      typeof contract.inputSchema !== 'function' ||
      typeof contract.outputSchema !== 'function' ||
      typeof contract.preconditions !== 'function' ||
      typeof contract.postconditions !== 'function' ||
      !ID_RE.test(contract.policyRef || '') ||
      contract.maxCostCents !== 0 ||
      !ID_RE.test(contract.idempotencyKey || '') ||
      !Number.isSafeInteger(contract.deadlineMs) || contract.deadlineMs < 100 || contract.deadlineMs > 120_000 ||
      typeof contract.verify !== 'function' ||
      typeof contract.compensate !== 'function' ||
      !isPlainData(contract.evidenceRetention) ||
      !Number.isSafeInteger(contract.evidenceRetention.retainDays) || contract.evidenceRetention.retainDays < 1) {
    throw Error('universal-broker-contract-invalid');
  }
  return Object.freeze({ ...contract });
}

export function createUniversalExecutionBroker({
  db,
  authorize = async () => ({ authorized: false, reason: 'policy-denied' }),
  refreshCredential = async () => ({ refreshed: false, reason: 'refresh-unsupported' }),
  clock = () => Date.now(),
} = {}) {
  if (typeof db?.query !== 'function' || typeof authorize !== 'function' || typeof refreshCredential !== 'function') {
    throw Error('universal-broker-deps-invalid');
  }

  const attempts = new Map();
  const fencingByResource = new Map();

  async function persistReceipt(attemptId, fingerprint, state, receipt) {
    const dbStatus = (state === 'COMPLETED' || state === 'COMPENSATED')
      ? 'completed'
      : (state === 'RECONCILE_REQUIRED' || state === 'EXECUTING' || state === 'VERIFYING')
        ? 'reconcile-required'
        : 'approval-pending';
    await db.query(
      `INSERT INTO capability_attempts (attempt_id, fingerprint, status, receipt, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (attempt_id) DO UPDATE
         SET status = EXCLUDED.status, receipt = EXCLUDED.receipt, updated_at = NOW()
         WHERE capability_attempts.fingerprint = EXCLUDED.fingerprint`,
      [attemptId, fingerprint, dbStatus, JSON.stringify(receipt)],
    );
  }

  async function execute(rawContract, rawInput, { executeProvider, workerId = `worker-${randomUUID().slice(0, 8)}` } = {}) {
    if (typeof executeProvider !== 'function') throw Error('universal-broker-provider-missing');
    const c = validateOperationContract(rawContract);
    const input = JSON.parse(JSON.stringify(rawInput ?? {}));
    if (c.inputSchema(input) !== true) throw Error('universal-broker-input-schema-invalid');

    const attemptId = `${c.provider}:${c.operation}:${c.idempotencyKey}`;
    const fingerprint = sha256({
      provider: c.provider,
      executionMethod: c.executionMethod,
      actorRef: c.actorRef,
      resourceId: c.resourceId,
      operation: c.operation,
      effect: c.effect,
      scope: c.scope,
      policyRef: c.policyRef,
      maxCostCents: c.maxCostCents,
      idempotencyKey: c.idempotencyKey,
      input,
    });

    const existingDb = await db.query('SELECT fingerprint, status, receipt FROM capability_attempts WHERE attempt_id = $1', [attemptId]);
    if (existingDb.rows.length > 0) {
      const row = existingDb.rows[0];
      if (row.fingerprint !== fingerprint) throw Error('universal-broker-idempotency-conflict');
      const priorReceipt = typeof row.receipt === 'string' ? JSON.parse(row.receipt) : row.receipt;
      if (TERMINAL_STATES.has(priorReceipt?.state) || priorReceipt?.state === 'RECONCILE_REQUIRED') {
        return Object.freeze({ ...priorReceipt, resumed: true });
      }
    }

    const history = [];
    const transition = (state, detail = {}) => {
      history.push(Object.freeze({ state, at: clock(), ...detail }));
      return state;
    };

    let state = transition('RECEIVED');
    if ((await c.preconditions(input)) !== true) {
      state = transition('FAILED', { reason: 'preconditions-failed' });
      const receipt = Object.freeze({ attemptId, fingerprint, state, history, costCents: 0, resumed: false });
      await persistReceipt(attemptId, fingerprint, state, receipt);
      return receipt;
    }
    state = transition('PLANNED');

    let authResult = await authorize({ contract: c, input, fingerprint });
    if (authResult?.reason === 'credential-expired') {
      const renewed = await refreshCredential({ provider: c.provider, actorRef: c.actorRef, scope: c.scope });
      if (renewed?.refreshed === true) {
        authResult = await authorize({ contract: c, input, fingerprint });
      }
    }
    if (authResult?.revoked === true) {
      state = transition('REVOKED', { reason: authResult.reason || 'revoked' });
      const receipt = Object.freeze({ attemptId, fingerprint, state, history, costCents: 0, resumed: false });
      await persistReceipt(attemptId, fingerprint, state, receipt);
      return receipt;
    }
    if (authResult?.authorized !== true) {
      state = transition('HELD', { reason: authResult?.reason || 'authorization-required' });
      const receipt = Object.freeze({ attemptId, fingerprint, state, history, costCents: 0, resumed: false });
      await persistReceipt(attemptId, fingerprint, state, receipt);
      return receipt;
    }
    state = transition('AUTHORIZED');

    const prevGen = fencingByResource.get(c.resourceId) || 0;
    const fencingToken = prevGen + 1;

    const claimReceipt = Object.freeze({ attemptId, fingerprint, state: 'CLAIMED', workerId, fencingToken, history, costCents: 0 });
    const inserted = await db.query(
      `INSERT INTO capability_attempts (attempt_id, fingerprint, status, receipt)
       VALUES ($1, $2, 'approval-pending', $3::jsonb)
       ON CONFLICT (attempt_id) DO NOTHING
       RETURNING attempt_id`,
      [attemptId, fingerprint, JSON.stringify(claimReceipt)],
    );
    if (inserted.rows.length === 0) {
      const winner = await db.query('SELECT fingerprint, receipt FROM capability_attempts WHERE attempt_id = $1', [attemptId]);
      const row = winner.rows[0];
      if (!row || row.fingerprint !== fingerprint) throw Error('universal-broker-idempotency-conflict');
      const r = typeof row.receipt === 'string' ? JSON.parse(row.receipt) : row.receipt;
      return Object.freeze({ ...r, resumed: true });
    }
    fencingByResource.set(c.resourceId, fencingToken);
    state = transition('CLAIMED', { workerId, fencingToken });

    // Re-check authorization after DB claim/wait and verify fencing token.
    const preDispatchAuth = await authorize({ contract: c, input, fingerprint });
    if (preDispatchAuth?.authorized !== true || fencingByResource.get(c.resourceId) !== fencingToken) {
      state = transition(preDispatchAuth?.revoked ? 'REVOKED' : 'HELD', { reason: 'pre-dispatch-authority-or-fence-lost' });
      const heldReceipt = Object.freeze({ attemptId, fingerprint, state, workerId, fencingToken, history, costCents: 0, resumed: false });
      await persistReceipt(attemptId, fingerprint, state, heldReceipt);
      return heldReceipt;
    }

    const reconcileReceipt = Object.freeze({
      attemptId,
      fingerprint,
      state: 'RECONCILE_REQUIRED',
      workerId,
      fencingToken,
      history: [...history, Object.freeze({ state: 'RECONCILE_REQUIRED', at: clock() })],
      costCents: 0,
      resumed: false,
    });
    await persistReceipt(attemptId, fingerprint, 'RECONCILE_REQUIRED', reconcileReceipt);

    state = transition('EXECUTING');
    const startedAt = clock();
    let providerOutput;
    try {
      providerOutput = await executeProvider({ contract: c, input, fencingToken });
      if (clock() - startedAt > c.deadlineMs || c.outputSchema(providerOutput) !== true) {
        throw Error('universal-broker-provider-output-or-deadline-invalid');
      }
    } catch (err) {
      state = transition('RECONCILE_REQUIRED', { reason: err.message });
      const rec = Object.freeze({ attemptId, fingerprint, state, workerId, fencingToken, history, costCents: 0, resumed: false });
      await persistReceipt(attemptId, fingerprint, state, rec);
      attempts.set(attemptId, rec);
      return rec;
    }

    state = transition('VERIFYING');
    let verified;
    try {
      verified = (await c.verify({ input, output: providerOutput })) === true && (await c.postconditions(providerOutput)) === true;
    } catch {
      verified = false;
    }
    if (!verified) {
      state = transition('RECONCILE_REQUIRED', { reason: 'independent-verification-failed' });
      const rec = Object.freeze({
        attemptId,
        fingerprint,
        state,
        workerId,
        fencingToken,
        resultDigest: sha256(providerOutput),
        history,
        costCents: 0,
        resumed: false,
      });
      await persistReceipt(attemptId, fingerprint, state, rec);
      attempts.set(attemptId, rec);
      return rec;
    }

    // Final authority check before marking COMPLETED.
    const postAuth = await authorize({ contract: c, input, fingerprint });
    if (postAuth?.authorized !== true) {
      state = transition('RECONCILE_REQUIRED', { reason: 'revoked-before-completion' });
      const rec = Object.freeze({
        attemptId,
        fingerprint,
        state,
        workerId,
        fencingToken,
        resultDigest: sha256(providerOutput),
        history,
        costCents: 0,
        resumed: false,
      });
      await persistReceipt(attemptId, fingerprint, state, rec);
      return rec;
    }

    state = transition('COMPLETED');
    const completedReceipt = Object.freeze({
      attemptId,
      fingerprint,
      state,
      workerId,
      fencingToken,
      resultDigest: sha256(providerOutput),
      history,
      costCents: 0,
      resumed: false,
    });
    await persistReceipt(attemptId, fingerprint, state, completedReceipt);
    attempts.set(attemptId, completedReceipt);
    return completedReceipt;
  }

  async function compensate(rawContract, rawInput, priorReceipt) {
    const c = validateOperationContract(rawContract);
    if (!priorReceipt || !['RECONCILE_REQUIRED', 'COMPLETED', 'FAILED'].includes(priorReceipt.state)) {
      throw Error('universal-broker-compensation-ineligible');
    }
    const compResult = await c.compensate({ input: rawInput, priorReceipt });
    if (compResult?.compensated !== true) throw Error('universal-broker-compensation-failed');
    const history = [...(priorReceipt.history || []), Object.freeze({ state: 'COMPENSATED', at: clock() })];
    const compensatedReceipt = Object.freeze({
      ...priorReceipt,
      state: 'COMPENSATED',
      compensationDigest: sha256(compResult),
      history,
      resumed: false,
    });
    await persistReceipt(priorReceipt.attemptId, priorReceipt.fingerprint, 'COMPENSATED', compensatedReceipt);
    return compensatedReceipt;
  }

  return Object.freeze({ execute, compensate });
}

export async function runRemediationLoop({
  issueId,
  maxAttempts = 3,
  detect,
  classify,
  reproduce,
  diagnose,
  patch,
  test,
  review,
  land,
  verify,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!ID_RE.test(issueId || '') || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw Error('remediation-config-invalid');
  }
  const detected = await detect({ issueId });
  if (!detected?.found) return Object.freeze({ status: 'NO_DEFECT', issueId });
  const classification = await classify(detected);
  const repro = await reproduce(classification);
  if (repro?.reproduced !== true) {
    return Object.freeze({ status: 'HELD', issueId, reason: 'not-reproducible', classification });
  }
  const attempted = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const diag = await diagnose({ classification, repro, attempt, attempted });
    const patched = await patch({ diag, attempt });
    const testResult = await test({ patched, attempt });
    attempted.push({ attempt, diagDigest: sha256(diag), patchDigest: sha256(patched), passed: testResult?.passed === true });
    if (testResult?.passed !== true) continue;
    const rev = await review({ patched, testResult, attempt });
    if (rev?.approved !== true) continue;
    const landed = await land({ patched, rev, attempt });
    if (landed?.landed !== true) continue;
    const verified = await verify({ landed, attempt });
    if (verified?.verified === true) {
      return Object.freeze({ status: 'REMEDIATED', issueId, attempt, attempted, landed, verified, completedAt: clock() });
    }
  }
  return Object.freeze({
    status: 'INCIDENT_RECORDED',
    incident: Object.freeze({
      schema: 'ultron.incident.v1',
      issueId,
      classification,
      attempted,
      recordedAt: clock(),
      reason: 'retry-budget-exhausted',
    }),
  });
}
