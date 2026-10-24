import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
 buildCouncilAssessmentReceipts,evaluateCouncilEvidence
} from '../cloud/hatchable/lib/council-evidence.js';

const SHA='a'.repeat(40),OTHER_SHA='b'.repeat(40);
const NOW='2026-10-24T12:00:00.000Z';
const OBSERVED='2026-10-24T11:00:00.000Z';
const OBJECTIVE='council-cycle-001';
function observations(){
 return [
  {taskId:1,receiptId:101,objective:'repo.inspect',observedAt:OBSERVED,
   result:{sha:SHA}},
  {taskId:2,receiptId:102,objective:'repo.ci',observedAt:OBSERVED,
   result:{runs:[{conclusion:'success'}]}},
  {taskId:3,receiptId:103,objective:'repo.prs',observedAt:OBSERVED,
   result:{count:0}},
  {taskId:4,receiptId:104,objective:'site.render',observedAt:OBSERVED,
   result:{has_app_shell:true}}
 ];
}
function deterministicReceipts(){
 return buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,sourceSha:SHA,
  observations:observations(),assessedAt:NOW});
}
function independent(receipt,id='external-reviewer-1',identityReceiptId=901){
 return {...receipt,reviewer:{kind:'independent-reviewer',id,
  identitySource:'github-review',identityReceiptId},
  taskIds:[9],taskReceiptIds:[identityReceiptId]};
}
function evaluation(overrides={}){
 return {frozen:true,setsDisjoint:true,sourceSha:SHA,runtimeSourceSha:SHA,
  independentlyObserved:true,outcomeReadbacksObserved:true,
  baselineScore:.5,candidateScore:.7,candidateFailures:0,criticalRegressions:0,
  ...overrides};
}
function ready(overrides={}){
 const profiles=deterministicReceipts();
 return evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,now:NOW,
  receipts:[...profiles,independent(profiles[0])],evaluation:evaluation(),...overrides});
}

test('cloud council emits versioned source-bound deterministic assessment receipts',()=>{
 const receipts=deterministicReceipts();
 assert.equal(receipts.length,4);
 assert.deepEqual(receipts.map(x=>x.role),['verifier','sentinel','planner','skeptic']);
 for(const receipt of receipts){
  assert.equal(receipt.schema,'ultron.council-assessment.v1');
  assert.equal(receipt.objectiveId,OBJECTIVE);
  assert.equal(receipt.sourceSha,SHA);
  assert.equal(receipt.reviewer.kind,'deterministic-role-profile');
  assert.equal(receipt.evidenceFreshness,'fresh');
  assert.equal(receipt.authority.executable,false);
  assert.equal(receipt.modelInvocations,0);
  assert.equal(receipt.creditCost,0);
  assert.equal(Object.isFrozen(receipt),true);
 }
});
test('zero receipts and fixed profiles alone cannot become independent approval',()=>{
 const empty=evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,
  receipts:[],now:NOW});
 assert.equal(empty.eligibleForProtectedPromotion,false);
 assert.ok(empty.reasons.includes('council-receipts-missing'));
 const fixed=evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,
  receipts:deterministicReceipts(),now:NOW,evaluation:evaluation()});
 assert.equal(fixed.independentReviewerCount,0);
 assert.ok(fixed.reasons.includes('independent-reviewer-missing'));
 const relabeled={...deterministicReceipts()[0],reviewer:{
  kind:'independent-reviewer',id:'relabeled-profile'}};
 const forged=evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,
  receipts:[relabeled],now:NOW,evaluation:evaluation()});
 assert.ok(forged.reasons.includes('independent-identity-unverified'));
 assert.equal(forged.independentReviewerCount,0);
});

test('duplicate replay and contradictory role assessments fail closed',()=>{
 const profiles=deterministicReceipts();
 const replay=ready({receipts:[...profiles,independent(profiles[0]),{...profiles[1]}]});
 assert.ok(replay.reasons.includes('duplicate-receipt-replay'));
 const conflict=ready({receipts:[...profiles,independent({...profiles[0],
  assessment:'main-not-observed',recommendation:'refresh-main'})]});
 assert.ok(conflict.reasons.includes('contradictory-assessment'));
});

test('stale evidence, stale source and a stale lease cannot pass the gate',()=>{
 const stale=buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,sourceSha:SHA,
  observations:observations(),assessedAt:NOW,maxEvidenceAgeMs:1});
 const staleGate=evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,
  receipts:[...stale,independent(stale[0])],now:NOW,evaluation:evaluation()});
 assert.ok(staleGate.reasons.includes('stale-evidence'));
 const wrongSource=ready({evaluation:evaluation({sourceSha:OTHER_SHA})});
 assert.ok(wrongSource.reasons.includes('evaluation-source-mismatch'));
 const lostLease=ready({lease:{state:'expired',tokenMatches:false}});
 assert.ok(lostLease.reasons.includes('stale-or-mismatched-lease'));
});

test('provider denial or an absent required token remains a hard hold',()=>{
 const denied=ready({provider:{required:true,status:'denied',tokenPresent:false}});
 assert.ok(denied.reasons.includes('provider-not-ready'));
 const missing=ready({provider:{required:true,status:'ready',tokenPresent:false}});
 assert.ok(missing.reasons.includes('provider-not-ready'));
});

test('self-reported or hallucinated success is not observed outcome evidence',()=>{
 const report=ready({evaluation:evaluation({outcomeReadbacksObserved:false})});
 assert.ok(report.reasons.includes('outcomes-not-independently-observed'));
 assert.equal(report.eligibleForProtectedPromotion,false);
});

test('lost write response with committed readback reconciles without replay',()=>{
 const report=ready({externalActions:[{id:'github-write-1',state:'uncertain',
  readback:'committed'}]});
 assert.equal(report.eligibleForProtectedPromotion,true);
 assert.deepEqual(report.reconciledExternalActions,['github-write-1']);
 assert.deepEqual(report.replayExternalActions,[]);
 assert.equal(report.eligibleForExecution,false);
});

test('held-out failure and postmerge source/runtime mismatch remain blocked',()=>{
 const failed=ready({evaluation:evaluation({candidateFailures:1})});
 assert.ok(failed.reasons.includes('held-out-candidate-failure'));
 const mismatch=ready({evaluation:evaluation({runtimeSourceSha:OTHER_SHA})});
 assert.ok(mismatch.reasons.includes('postmerge-source-runtime-mismatch'));
});

test('malformed assessment input cannot be counted as a vote',()=>{
 const profiles=deterministicReceipts();
 const malformed={...profiles[0],taskReceiptIds:[]};
 const report=ready({receipts:[malformed,independent(profiles[1])]});
 assert.ok(report.reasons.includes('malformed-receipt'));
 assert.equal(report.eligibleForProtectedPromotion,false);
});

test('hosted council output binds SQL receipt ids and remains advisory-only',async()=>{
 const evidenceSource=await readFile(new URL('../cloud/hatchable/lib/council-evidence.js',
  import.meta.url),'utf8');
 const evidenceUrl='data:text/javascript;base64,'+
  Buffer.from(evidenceSource).toString('base64');
 const coreSource=await readFile(new URL('../cloud/hatchable/lib/brain-core.js',
  import.meta.url),'utf8');
 const coreUrl='data:text/javascript;base64,'+Buffer.from(coreSource.replace(
  "from 'lib/council-evidence.js'","from '"+evidenceUrl+"'"
 )).toString('base64');
 const {executeObjective}=await import(coreUrl);
 const rows=observations().map(item=>({id:item.taskId,task_key:'task-'+item.taskId,
  objective:item.objective,status:'done',last_result:item.result,
  updated_at:item.observedAt,receipt_id:item.receiptId}));
 const result=await executeObjective('council.review',{
  db:{query:async()=>({rows})},browser:{},task:{taskKey:OBJECTIVE}
 });
 assert.equal(result.assessment_receipts.length,4);
 assert.deepEqual(result.assessment_receipts.map(x=>x.taskReceiptIds[0]),
  [101,102,103,104]);
 assert.equal(result.promotion_gate.eligibleForProtectedPromotion,false);
 assert.ok(result.promotion_gate.reasons.includes('independent-reviewer-missing'));
 assert.ok(result.promotion_gate.reasons.includes('held-out-evaluation-missing'));
 assert.equal(result.disposition,'proposals-only-no-write-or-model-inference');
});

