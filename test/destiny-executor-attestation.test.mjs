import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {assessDestinyCanary, canonicalDestinyReceipt, DESTINY_RECEIPT_SCHEMA}
  from '../src/destiny-executor-attestation.mjs';

const {publicKey, privateKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const NOW=Date.parse('2026-11-02T20:00:00.000Z');
const INTENT=Object.freeze({
  repository:'michaeljwilliams0123/Ultron.MW',
  taskId:'ucc-canary-000000000001',
  deliveryId:'continuum-destiny-0001',
  requestSha:'a'.repeat(64),
  sourceSha:'b'.repeat(40),
  routeSha:'c'.repeat(64),
  effect:'read',
  maxPaidCents:0
});
const TRUST=Object.freeze({
  state:'configured',
  appLogin:'ultron-destiny-executor[bot]',
  keyId:'destiny-executor-k1',
  publicKeyPem
});
function payload(patch={}){
  return {
    schema:DESTINY_RECEIPT_SCHEMA,
    repository:INTENT.repository,taskId:INTENT.taskId,
    deliveryId:INTENT.deliveryId,requestSha:INTENT.requestSha,
    sourceSha:INTENT.sourceSha,routeSha:INTENT.routeSha,
    authorId:'destiny-codex',
    appLogin:TRUST.appLogin,
    keyId:TRUST.keyId,
    effect:'read',maxPaidCents:0,
    status:'completed',
    resultSha:'d'.repeat(64),
    issuedAt:'2026-11-02T19:59:00.000Z',
    expiresAt:'2026-11-02T20:01:00.000Z',
    ...patch
  };
}
function wire(p=payload(), key=privateKey) {
  const signature=sign(null,Buffer.from(canonicalDestinyReceipt(p)),key)
    .toString('base64');
  return {receipt:p,signature};
}
function inspect(options={}){
  const signable=options.receipt && typeof options.receipt==='object' &&
    !Array.isArray(options.receipt) ? options.receipt : payload();
  const signed=wire(signable);
  return assessDestinyCanary({
    intent:INTENT,trust:TRUST,
    observedGitHubActor:TRUST.appLogin,
    now:NOW,...signed,...options
  });
}
test('RED: a separately signed scoped completion is a receipt, not Work account or production proof',()=>{
  const report=inspect();
  assert.equal(report.status,'verified-executor-receipt');
  assert.equal(report.verifiedReceipt,true);
  assert.equal(report.productionAccepted,false);
  assert.equal(report.workAccountAuthenticated,false);
  assert.match(report.receiptSha,/^[a-f0-9]{64}$/);
});
test('RED: missing App enrollment or independently pinned public key fails closed',()=>{
  for(const trust of [
    {...TRUST,state:'unconfigured'},
    {...TRUST,publicKeyPem:null},
    {...TRUST,keyId:null},
  ]){
    const report=inspect({trust});
    assert.equal(report.verifiedReceipt,false);
    assert.equal(report.status,'blocked-unconfigured');
  }
});
test('RED: GitHub owner, fake app login, or missing actor cannot attest Destiny',()=>{
  for(const observedGitHubActor of ['michaeljwilliams0123','github-actions[bot]','ultron-destiny-executor',null]){
    const report=inspect({observedGitHubActor});
    assert.equal(report.status,'blocked-actor');
    assert.equal(report.verifiedReceipt,false);
  }
});
test('RED: signature modification, wrong signer, or malformed signature is rejected',()=>{
  const signed=wire();
  const otherKey=generateKeyPairSync('ed25519').privateKey;
  for(const sample of [
    {...signed,receipt:{...signed.receipt,resultSha:'f'.repeat(64)}},
    wire(payload(),otherKey),
    {...signed,signature:'not-a-base64-signature'}
  ]){
    const report=inspect(sample);
    assert.equal(report.status,'blocked-signature');
  }
});
test('RED: exact intent/source/route/delivery and zero-spend are mandatory',()=>{
  for(const patch of [
    {taskId:'ucc-foreign-00000000001'},{deliveryId:'continuum-other-0001'},
    {requestSha:'e'.repeat(64)},{sourceSha:'0'.repeat(40)},
    {routeSha:'1'.repeat(64)},{repository:'another/repo'},
    {effect:'write'},{maxPaidCents:1},
    {authorId:'mike-codex'},{appLogin:'github-actions[bot]'},
    {keyId:'previous-rotation'}
  ]){
    const report=inspect({receipt:payload(patch)});
    assert.equal(report.verifiedReceipt,false,JSON.stringify(patch));
    assert.ok(report.status.startsWith('blocked-'),JSON.stringify(patch));
  }
});
test('RED: ACK, running, forged keys and extra fields cannot pass completion attestation',()=>{
  for(const patch of [
    {status:'acknowledged'},{status:'running'},
    {unknown:'additional-field'},
    {resultSha:'not-a-digest'},
    {issuedAt:'unparseable'},
    {expiresAt:'2026-11-02T19:58:00.000Z'},
    {issuedAt:'2026-11-02T19:59:00Z'}
  ]) {
    const report=inspect({receipt:payload(patch)});
    assert.equal(report.verifiedReceipt,false,JSON.stringify(patch));
  }
});
test('RED: expired and excessively future-dated signed receipts are rejected',()=>{
  for(const patch of [
    {issuedAt:'2026-11-02T19:50:00.000Z',expiresAt:'2026-11-02T19:52:00.000Z'},
    {issuedAt:'2026-11-02T20:10:00.000Z',expiresAt:'2026-11-02T20:11:00.000Z'},
    {issuedAt:'2026-11-02T19:59:00.000Z',expiresAt:'2026-11-02T20:20:00.000Z'}
  ]) {
    assert.equal(inspect({receipt:payload(patch)}).status,'blocked-expired');
  }
});
test('RED: a previously observed same delivery does not trigger re-execution',()=>{
  const first=inspect();
  assert.equal(inspect({priorReceiptSha:first.receiptSha}).status,'already-recorded');
  assert.equal(inspect({priorReceiptSha:'f'.repeat(64)}).status,'reconcile-required');
  assert.equal(inspect({priorReceiptSha:'unknown'}).status,'reconcile-required');
});
test('RED: malformed envelope and invalid trusted intent do not throw into a success state',()=>{
  for(const bad of [null,[],{},'raw',true]) {
    const report=inspect({receipt:bad,signature:'hello'});
    assert.equal(report.verifiedReceipt,false);
  }
  assert.equal(inspect({intent:{...INTENT,maxPaidCents:1}}).status,'blocked-intent');
  assert.equal(inspect({intent:{...INTENT,sourceSha:'unknown'}}).status,'blocked-intent');
});

// Clock skew is bounded independently of the maximum receipt lifetime.
test('RED: a signed result from more than 30 seconds in the future is rejected',()=>{
  const report=inspect({receipt:payload({
    issuedAt:'2026-11-02T20:00:31.000Z',
    expiresAt:'2026-11-02T20:02:00.000Z'
  })});
  assert.equal(report.status,'blocked-expired');
  assert.equal(report.verifiedReceipt,false);
});

test('RED: expired receipt remains rejected even for an identical prior receipt digest',()=>{
  const first=inspect();
  const expired=inspect({now:NOW+180000,priorReceiptSha:first.receiptSha});
  assert.equal(expired.status,'blocked-expired');
  assert.equal(expired.verifiedReceipt,false);
});
