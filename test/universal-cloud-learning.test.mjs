import test from 'node:test';
import assert from 'node:assert/strict';
import { assessUniversalCloudSkill } from '../src/universal-cloud-learning.mjs';
import { cloudReceiptFingerprint } from '../src/universal-cloud-executor.mjs';

const receipt={
  idempotencyKey:'cloud:gitlab:task-001',provider:'gitlab',
  operation:'gitlab.branch.create',target:'project:87884831:branch:ultron-task-1',
  requestDigest:'a'.repeat(64),fencingEpoch:11,costCents:0,
  externalId:'gl-branch-1',verifiedAt:'2026-11-17T23:00:00.000Z',
};
const trajectory={
  schema:'ultron.cloud-trajectory.v1',fingerprint:cloudReceiptFingerprint(receipt),
  provider:'gitlab',operation:'gitlab.branch.create',outcome:'succeeded',
  independentlyObserved:true,costUsd:0,
};
const candidate={
  id:'gitlab-branch-v2',method:'reef-assisted',
  sourceSha:'a'.repeat(40),feedbackReceiptIds:['gl-branch-1'],
  developmentCaseIds:['case-0','case-1'],
  baselineArtifact:{kind:'skill',id:'gitlab-branch',version:'1',sha256:'b'.repeat(64)},
  candidateArtifact:{kind:'skill',id:'gitlab-branch',version:'2',sha256:'c'.repeat(64)},
  reef:{runtimeVerified:true,recordId:'reef-record-1'},
};
const outcome=(score)=>({status:'succeeded',score,invariantsPassed:true,
  independentlyObserved:true,evidence:'receipt:gl-branch-1',
  latencyMs:100,costUsd:0,humanIntervention:false});
const cases=Array.from({length:4},(_,i)=>({
  id:'case-'+i,split:i<2?'development':'heldout',critical:i===2,
  baseline:outcome(.4),candidate:outcome(.7),
}));
const evaluator={id:'reef-external-heldout',version:'1',sha256:'e'.repeat(64),
  origin:'external-independent',kind:'deterministic-evaluator'};
const verifiedReceipt=async()=>({
  source:'postgres-readback',status:'completed',verified:true,receipt,
});
const args={
  trajectory,receiptKey:receipt.idempotencyKey,readVerifiedReceipt:verifiedReceipt,
  candidate,cases,evaluator,groundTruth:{source:'external'},
};
test('Reef accepts independently observed cloud skill selection, never publishes it',async()=>{
  const result=await assessUniversalCloudSkill(args);
  assert.equal(result.disposition,'Accepted');
  assert.equal(result.publication,'not-performed');
  assert.equal(result.releaseAuthority,'github-protected-pr');
});
test('unverified DB outcome or mismatched fingerprint blocks skill selection',async()=>{
  for(const bad of [
    {verified:false},{source:'caller-asserted'},
    {receipt:{...receipt,requestDigest:'d'.repeat(64)}},
    {status:'reconcile_required'},
  ]){
    const r=await assessUniversalCloudSkill({...args,
      readVerifiedReceipt:async()=>({...await verifiedReceipt(),...bad}),
    });
    assert.equal(r.disposition,'Blocked');
  }
});
test('untrusted trajectory and missing external ground truth cannot promote',async()=>{
  const missing=await assessUniversalCloudSkill({...args,
    trajectory:{...trajectory,independentlyObserved:false}});
  assert.equal(missing.disposition,'Blocked');
  const abstained=await assessUniversalCloudSkill({
    ...args,groundTruth:{source:'synthetic'}});
  assert.equal(abstained.disposition,'Inconclusive');
});
