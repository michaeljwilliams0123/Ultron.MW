import { createHash } from 'node:crypto';

// Server-side Council execution ledger (C04). Every transition is a single
// guarded UPDATE (compare-and-set on the expected state), so duplicate or racing
// requests can never move a record twice. Evidence only: no authority is granted.
const ROLES = ['Builder', 'Skeptic', 'Steward', 'Predictor', 'Generator', 'Sentinel', 'Companion'];
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const PLAN_ONLY = ['web.open', 'mahoraga.repo.inspect', 'mahoraga.task.prepare'];
const RECEIPT_VERSION = 'council-execution-receipt/2';
const COORDINATOR_APP_ID = 5633654;
const COORDINATOR_SLUGS = ['ultron-mw-builder-v2', 'ultron-coordinator'];
const TRANSITIONS = {
  reserved: ['dispatched', 'failed'],
  dispatched: ['verified', 'executed', 'failed', 'reconcile-required'],
  'reconcile-required': ['verified', 'executed', 'failed']
};
const COLUMNS = `execution_key,case_digest,role_id,operation,ordinal,source_sha,state,auth_context,
  expected_effect,executor,effect_url,receipt,receipt_digest,reason,history,created_at,updated_at`;

function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

export function executionKey({ role, operation, caseSha, sourceSha, ordinal = 0 } = {}) {
  if (!ROLES.includes(role) || typeof operation !== 'string' || !operation || operation.length > 60 ||
    !SHA64.test(caseSha || '') || !SHA40.test(sourceSha || '') ||
    !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 1000) throw new Error('execution-key-invalid');
  return createHash('sha256').update([role, operation, caseSha, sourceSha, ordinal].join('\n')).digest('hex');
}

export function receiptValid(receipt) {
  try {
    if (!receipt || receipt.version !== RECEIPT_VERSION || !ROLES.includes(receipt.role) ||
      !SHA64.test(receipt.digest || '') || !SHA64.test(receipt.caseSha || '') ||
      !Number.isSafeInteger(receipt.installationId) || receipt.installationId < 1 ||
      !Number.isSafeInteger(receipt.app?.id) || receipt.app.id < 1 ||
      receipt.claims?.independentReview !== false || receipt.claims?.modelInvoked !== false) return false;
    const coordinator = receipt.role === 'Builder' && receipt.app.id === COORDINATOR_APP_ID &&
      COORDINATOR_SLUGS.includes(receipt.app.slug);
    const member = receipt.app.id !== COORDINATOR_APP_ID &&
      receipt.app.slug === 'ultron-mw-' + receipt.role.toLowerCase();
    const bindingKey = coordinator ? 'coordinator-v2' : 'council-member';
    const kind = coordinator ? 'coordinator' : 'council-member';
    if ((!coordinator && !member) || receipt.app.bindingKey !== bindingKey ||
      receipt.app.kind !== kind || receipt.effect?.author !== receipt.app.slug + '[bot]') return false;
    const { digest, ...body } = receipt;
    return createHash('sha256').update(canonicalJson(body)).digest('hex') === digest;
  } catch {
    return false;
  }
}

function shape(row) {
  if (!row) return null;
  return {
    key: row.execution_key, caseDigest: row.case_digest, role: row.role_id, operation: row.operation,
    ordinal: row.ordinal, sourceSha: row.source_sha, state: row.state, authContext: row.auth_context,
    expectedEffect: row.expected_effect, executor: row.executor, effectUrl: row.effect_url,
    receipt: row.receipt, receiptDigest: row.receipt_digest, reason: row.reason, history: row.history
  };
}

export async function readExecution(db, key) {
  if (!SHA64.test(key || '')) throw new Error('execution-key-invalid');
  const r = await db.query(`SELECT ${COLUMNS} FROM brain_council_executions WHERE execution_key=$1`, [key]);
  return shape(r.rows[0]);
}

export async function listOpenExecutions(db, limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const r = await db.query(
    `SELECT ${COLUMNS} FROM brain_council_executions
     WHERE state IN ('reserved','dispatched','reconcile-required') ORDER BY updated_at LIMIT ${n}`);
  return r.rows.map(shape);
}

/** Idempotent: a duplicate request returns the existing record, created=false. */
export async function reserveExecution(db, input = {}) {
  const key = executionKey({ ...input, caseSha: input.caseDigest });
  const planOnly = PLAN_ONLY.includes(input.operation);
  const state = planOnly ? 'planned' : 'reserved';
  const history = planOnly ? ['planned'] : ['intent', 'reserved'];
  const auth = input.authContext && typeof input.authContext === 'object' && !Array.isArray(input.authContext)
    ? input.authContext : {};
  const r = await db.query(
    `WITH i AS (
       INSERT INTO brain_council_executions
        (execution_key,case_digest,role_id,operation,ordinal,source_sha,state,auth_context,expected_effect,history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)
       ON CONFLICT (execution_key) DO NOTHING RETURNING *),
     e AS (INSERT INTO brain_council_execution_events(execution_key,seq,from_state,to_state)
       SELECT execution_key,1,NULL,state FROM i)
     SELECT ${COLUMNS} FROM i`,
    [key, input.caseDigest, input.role, input.operation, input.ordinal || 0, input.sourceSha, state,
      JSON.stringify(auth), String(input.expectedEffect || '').slice(0, 300), JSON.stringify(history)]);
  if (r.rows[0]) return { created: true, record: shape(r.rows[0]) };
  return { created: false, record: await readExecution(db, key) };
}

/** Compare-and-set: succeeds only if the record is still in `from`. */
export async function transitionExecution(db, { key, from, to, detail = {} } = {}) {
  if (!SHA64.test(key || '') || !TRANSITIONS[from]?.includes(to)) throw new Error('transition-invalid');
  const current = await readExecution(db, key);
  if (!current) return { ok: false, error: 'not-found' };
  let executor = null;
  let url = null;
  let receipt = null;
  let digest = null;
  if (to === 'verified') {
    const x = detail.receipt;
    if (!receiptValid(x) || x.role !== current.role || x.operation !== current.operation ||
      x.caseSha !== current.caseDigest || x.sourceSha !== current.sourceSha) {
      return { ok: false, error: 'receipt-mismatch', record: current };
    }
    executor = x.effect.author;
    url = x.effect.url;
    receipt = x;
    digest = x.digest;
  }
  if (to === 'executed' || to === 'reconcile-required' && detail.url) {
    executor = String(detail.executor || '').slice(0, 80) || null;
    url = String(detail.url || '').slice(0, 300) || null;
    if (to === 'executed' && (!executor || !url)) return { ok: false, error: 'effect-required', record: current };
  }
  const reason = ['failed', 'reconcile-required'].includes(to) ? String(detail.reason || 'unspecified').slice(0, 200) : null;
  const r = await db.query(
    `WITH u AS (
       UPDATE brain_council_executions SET state=$3,executor=COALESCE($4,executor),effect_url=COALESCE($5,effect_url),
        receipt=COALESCE($6::jsonb,receipt),receipt_digest=COALESCE($7,receipt_digest),reason=COALESCE($8,reason),
        history=history||to_jsonb($3::text),updated_at=now()
       WHERE execution_key=$1 AND state=$2 RETURNING *),
     e AS (INSERT INTO brain_council_execution_events(execution_key,seq,from_state,to_state,detail)
       SELECT execution_key,jsonb_array_length(history),$2,$3,$9::jsonb FROM u)
     SELECT ${COLUMNS} FROM u`,
    [key, from, to, executor, url, receipt ? JSON.stringify(receipt) : null, digest, reason,
      JSON.stringify({ reason, executor, url })]);
  if (r.rows[0]) return { ok: true, record: shape(r.rows[0]) };
  return { ok: false, error: 'state-conflict', record: await readExecution(db, key) };
}
