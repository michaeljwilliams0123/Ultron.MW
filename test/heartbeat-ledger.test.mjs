import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeartbeatLedger,
  appendHeartbeatReceipt,
  reduceHeartbeatLedger,
} from '../src/heartbeat-ledger.mjs';

const sample = {
  kind: 'ultron-standby-receipt',
  observedAt: '2026-10-19T23:00:00.000Z',
  posture: 'waiting-for-owner',
  modelInvocations: 0,
  creditCost: 0,
  fingerprint: 'a'.repeat(64),
};

test('ledger accepts standby receipts and suppresses duplicates', () => {
  const receipts = [];
  const first = appendHeartbeatReceipt(receipts, sample);
  assert.equal(first.appended, true);
  const second = appendHeartbeatReceipt(receipts, sample);
  assert.equal(second.appended, false);
  assert.equal(second.reason, 'duplicate-suppressed');
  const ledger = createHeartbeatLedger([sample, sample]);
  assert.equal(ledger.receipts.length, 1);
  assert.equal(ledger.duplicatesSuppressed, 1);
});

test('reduce summarizes latest', () => {
  const reduced = reduceHeartbeatLedger([sample]);
  assert.equal(reduced.count, 1);
  assert.equal(reduced.latest.posture, 'waiting-for-owner');
});

test('heartbeat metrics must be finite and nonnegative; local retention bounded',()=>{
  const receipts=[];
  for(const record of [
    {...sample,creditCost:-1},
    {...sample,modelInvocations:Number.POSITIVE_INFINITY},
    {...sample,creditCost:'paid'},
  ])assert.throws(()=>appendHeartbeatReceipt(receipts,record),/heartbeat-metric-invalid/);
  for(let i=0;i<84;i++){
    appendHeartbeatReceipt(receipts,{...sample,
      fingerprint:i.toString(16).padStart(64,'0'),
      observedAt:new Date(Date.parse(sample.observedAt)+i*60000).toISOString()});
  }
  assert.equal(receipts.length,64);
  assert.equal(receipts.at(-1).fingerprint,(83).toString(16).padStart(64,'0'));
});
