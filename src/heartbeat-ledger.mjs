// Ultron heartbeat ledger — bounded, duplicate-suppressing standby receipt store.
// Adapted from the retained dissent-heartbeat branch. In-memory evidence only; no cloud wakeup, model call, or extra credential.

import { createHash } from 'node:crypto';

export const HEARTBEAT_LEDGER_KIND = 'ultron-heartbeat-ledger';
export const HEARTBEAT_LEDGER_SCHEMA_VERSION = 1;
export const HEARTBEAT_LEDGER_CAP = 64; // bounded local-only window, not persistent cloud activity

export function createHeartbeatLedger(records = []) {
  if (!Array.isArray(records)) fail('heartbeat-ledger-invalid');
  const receipts = [];
  let duplicatesSuppressed = 0;
  for (const record of records) {
    const result = appendHeartbeatReceipt(receipts, record);
    if (result.appended === false && result.reason === 'duplicate-suppressed') {
      duplicatesSuppressed += 1;
    }
  }
  return freezeLedger(receipts, duplicatesSuppressed);
}

export function appendHeartbeatReceipt(receipts, receipt) {
  if (!Array.isArray(receipts)) fail('heartbeat-ledger-invalid');
  const normalized = normalizeReceipt(receipt);
  if (receipts.some(existing => existing.fingerprint === normalized.fingerprint)) {
    return Object.freeze({ appended: false, reason: 'duplicate-suppressed' });
  }
  while (receipts.length >= HEARTBEAT_LEDGER_CAP) receipts.shift();
  receipts.push(normalized);
  return Object.freeze({ appended: true, reason: 'accepted' });
}

export function reduceHeartbeatLedger(records = []) {
  const ledger = createHeartbeatLedger(records);
  return Object.freeze({
    kind: HEARTBEAT_LEDGER_KIND,
    schemaVersion: HEARTBEAT_LEDGER_SCHEMA_VERSION,
    count: ledger.receipts.length,
    duplicatesSuppressed: ledger.duplicatesSuppressed,
    latest: ledger.receipts.at(-1) || null,
    fingerprints: ledger.receipts.map(r => r.fingerprint),
  });
}

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('heartbeat-receipt-invalid');
  const kind = receipt.kind;
  if (kind !== 'ultron-standby-receipt' && kind !== 'grokbot-deliberation-receipt') {
    fail('heartbeat-receipt-invalid');
  }
  const observedAt = receipt.observedAt;
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    fail('heartbeat-receipt-invalid');
  }
  for(const field of ['modelInvocations','creditCost']) {
    const amount=receipt[field]??0;
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)
      fail('heartbeat-metric-invalid');
  }
  const fingerprint = typeof receipt.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(receipt.fingerprint)
    ? receipt.fingerprint
    : createHash('sha256').update(JSON.stringify({
      kind: receipt.kind,
      observedAt: receipt.observedAt,
      posture: receipt.posture || null,
      decision: receipt.decision || null,
    })).digest('hex');
  return Object.freeze({
    kind: receipt.kind,
    observedAt,
    posture: receipt.posture || null,
    decision: receipt.decision || null,
    modelInvocations: receipt.modelInvocations ?? 0,
    creditCost: receipt.creditCost ?? 0,
    fingerprint,
  });
}

function freezeLedger(receipts, duplicatesSuppressed) {
  return Object.freeze({
    kind: HEARTBEAT_LEDGER_KIND,
    schemaVersion: HEARTBEAT_LEDGER_SCHEMA_VERSION,
    receipts: Object.freeze([...receipts]),
    duplicatesSuppressed,
  });
}

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}
