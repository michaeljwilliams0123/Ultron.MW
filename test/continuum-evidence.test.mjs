import test from 'node:test';
import assert from 'node:assert/strict';
import {assessContinuumEvidence,assessContinuumEvidenceBatch} from '../src/continuum-evidence.mjs';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(64);
const base=()=>({
  schema:'ultron.continuum-evidence.v1',
  objectiveId:'objective-001',taskId:'task-001',deliveryId:'delivery-001',
  actorId:'github-owner',runtimeId:'hatchable-v24',
  baseSha:A,headSha:B,deployedSha:null,
  capability:'continuum.c01',policyVersion:'v1',
  authorization:{grantId:'grant-001',expiresAt:'2026-11-03T16:00:00.000Z',resource:'repo-ultron',fence:2},
  idempotencyKey:'continuum-delivery-001',attempt:1,
  intent:{effect:'read',preconditionSha:C,estimatedPaidCents:0},
  outcome:'acknowledged',readback:null,review:null,
  elapsedMs:10,observedPaidCents:0,artifacts:[]
});
const opts={expectedHeadSha:B,now:'2026-11-02T16:00:00.000Z'};
const receipt=()=>({
  observerId:'independent-receiver',deliveryId:'delivery-001',headSha:B,
  fence:2,observedEffect:'present',
  evidenceUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/issues/204'
});
const approval=()=>({
  reviewerId:'independent-reviewer',headSha:B,decision:'approved',
  evidenceUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/200'
});
test('a green source-only observation never certifies production acceptance',()=>{
  const result=assessContinuumEvidence(base(),opts);
  assert.equal(result.disposition,'source-only');
  assert.equal(result.productionAccepted,false);
});
test('unknown or acknowledged writes without independent readback require reconciliation',()=>{
  for(const outcome of ['unknown','acknowledged','failed']){
    const evidence=base();
    evidence.intent.effect='write';evidence.outcome=outcome;
    const result=assessContinuumEvidence(evidence,opts);
    assert.equal(result.disposition,'reconcile-required');
    assert.equal(result.productionAccepted,false);
  }
});
test('independent readback plus reviewer metadata remains evidence, not live release approval',()=>{
  const evidence=base();
  evidence.intent.effect='write';evidence.readback=receipt();evidence.review=approval();
  const result=assessContinuumEvidence(evidence,opts);
  assert.equal(result.disposition,'observed-not-accepted');
  assert.equal(result.productionAccepted,false);
});
test('self-observation and self-review cannot claim independent provenance',()=>{
  for(const mutation of [
    e=>{e.readback.observerId=e.actorId;},
    e=>{e.readback.observerId=e.runtimeId;},
    e=>{e.review.reviewerId=e.actorId;}
  ]){
    const e=base();e.intent.effect='write';e.readback=receipt();e.review=approval();mutation(e);
    assert.equal(assessContinuumEvidence(e,opts).disposition,'held');
  }
});
test('conflicting receipt identity, SHA, or lease cannot certify a write',()=>{
  for(const mutation of [
    e=>{e.readback.deliveryId='delivery-002';},
    e=>{e.readback.headSha=A;},
    e=>{e.readback.fence=3;},
    e=>{e.review.headSha=A;}
  ]){
    const e=base();e.intent.effect='write';e.readback=receipt();e.review=approval();mutation(e);
    assert.equal(assessContinuumEvidence(e,opts).disposition,'held');
  }
});
test('invalid dates, SHA, money, and fencing fail closed before acceptance',()=>{
  for(const mutation of [
    e=>{e.headSha='invalid';},
    e=>{e.authorization.expiresAt='2026-02-30T16:00:00.000Z';},
    e=>{e.authorization.expiresAt='2026-11-01T16:00:00.000Z';},
    e=>{e.intent.estimatedPaidCents=1;},
    e=>{e.observedPaidCents=1;},
    e=>{e.authorization.fence=0;},
    e=>{e.attempt='1';}
  ]){
    const e=base();mutation(e);
    assert.equal(assessContinuumEvidence(e,opts).disposition,'held');
  }
});
test('conflicting duplicate delivery payloads are not reconciled by choosing the favorable one',()=>{
  const a=base(),b=base();b.intent.preconditionSha='d'.repeat(64);
  const result=assessContinuumEvidenceBatch([a,b],opts);
  assert.equal(result.disposition,'held');
  assert.equal(result.productionAccepted,false);
  assert.equal(result.reason,'conflicting-delivery');
});
test('an exception-throwing evidence getter cannot bypass admission validation',()=>{
  const e=base();
  Object.defineProperty(e,'headSha',{get(){throw Error('untrusted getter');}});
  assert.equal(assessContinuumEvidence(e,opts).disposition,'held');
});
