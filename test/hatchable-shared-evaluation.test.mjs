import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {evaluateSharedEvaluation} from '../cloud/hatchable/lib/shared-evaluation.js';

const BASE='a'.repeat(40),CAND='b'.repeat(40);
const domains={execution:30,recovery:20,security:20,concurrency:15,deployment:10,resources:5};
const dimensions={completion:35,correctness:25,reliability:20,recovery:10,latency:5,cost:5};
const expanded=x=>Object.entries(x).flatMap(([label,count])=>Array(count).fill(label));
function corpus(){
 const ds=expanded(domains),ms=expanded(dimensions);
 return ds.map((domain,i)=>({caseId:'case-'+String(i+1).padStart(3,'0'),
  domain,dimension:ms[i],critical:domain==='security'&&i===50}));
}
function results(cases,sourceSha,failed=()=>false){
 return cases.map((c,i)=>({caseId:c.caseId,sourceSha,
  receiptId:(sourceSha===BASE?1000:2000)+i,passed:!failed(i)}));
}
function fixture(){
 const cases=corpus();
 return {cases,baseline:{sourceSha:BASE,outcomes:results(cases,BASE,i=>i<10)},
 candidate:{sourceSha:CAND,outcomes:results(cases,CAND)},
 candidateActor:'ultron:builder',
 evaluator:{id:'independent:evaluator-01',kind:'independent'},
 reviewer:{id:'independent:reviewer-02',kind:'independent',materialDissent:[]},
 subtle:webcrypto.subtle};
}
test('100 paired and attributable cases have weighted results and cryptographic case digest',async()=>{
 const result=await evaluateSharedEvaluation(fixture());
 assert.equal(result.schema,'ultron.shared-evaluation.v1');
 assert.equal(result.caseCount,100);
 assert.equal(result.baselineScore,90);
 assert.equal(result.candidateScore,100);
 assert.equal(result.improvementPoints,10);
 assert.equal(result.sharedThresholdMet,true);
 assert.match(result.caseDigest,/^[a-f0-9]{64}$/);
 assert.equal(result.heldOut,false);
 assert.equal(result.eligibleForProtectedPromotion,false);
 assert.equal(result.researchGate,'held-out-evaluation-not-proven');
});
test('shared benchmark never certifies unseen-task generalization or release authority',async()=>{
 const r=await evaluateSharedEvaluation(fixture());
 assert.equal(r.independentExecutionClaim,'unverified-caller-provided-identities');
 assert.ok(r.reasons.includes('shared-corpus-is-not-held-out'));
 assert.equal(r.eligibleForProtectedPromotion,false);
});
test('missing, duplicate and mislabeled case outcomes are rejected before scoring',async()=>{
 const f=fixture();
 await assert.rejects(evaluateSharedEvaluation({...f,candidate:{...f.candidate,
  outcomes:f.candidate.outcomes.slice(1)}}),/incomplete-candidate-outcomes/);
 await assert.rejects(evaluateSharedEvaluation({...f,cases:[f.cases[0],...f.cases.slice(0,99)]}),/duplicate-case-id/);
 await assert.rejects(evaluateSharedEvaluation({...f,candidate:{...f.candidate,
  outcomes:[{...f.candidate.outcomes[0],sourceSha:BASE},...f.candidate.outcomes.slice(1)]}}),/candidate-source-mismatch/);
});
test('the benchmark requires the approved exact 100-case domain and metric distribution',async()=>{
 const f=fixture();f.cases[0]={...f.cases[0],domain:'security'};
 await assert.rejects(evaluateSharedEvaluation(f),/invalid-case-domain-distribution/);
 const other=fixture();other.cases[0]={...other.cases[0],dimension:'cost'};
 await assert.rejects(evaluateSharedEvaluation(other),/invalid-case-metric-distribution/);
});
test('critical failures prevent promotion regardless of favorable aggregate score',async()=>{
 const f=fixture();
 f.candidate.outcomes[50]={...f.candidate.outcomes[50],passed:false};
 const r=await evaluateSharedEvaluation(f);
 assert.equal(r.criticalViolations,1);
 assert.equal(r.sharedThresholdMet,false);
 assert.ok(r.reasons.includes('critical-case-failure'));
});
test('material independent dissent blocks eligibility even with perfect candidate score',async()=>{
 const f=fixture();f.reviewer.materialDissent=['runtime-secret-exposure'];
 const r=await evaluateSharedEvaluation(f);
 assert.equal(r.sharedThresholdMet,false);
 assert.ok(r.reasons.includes('material-dissent-unresolved'));
});
test('reviewer and evaluator must differ from the candidate and each other',async()=>{
 const f=fixture();
 for(const bad of [
  {...f,evaluator:{...f.evaluator,id:f.candidateActor}},
  {...f,reviewer:{...f.reviewer,id:f.evaluator.id}},
  {...f,reviewer:{...f.reviewer,kind:'self'}}
 ]){
  await assert.rejects(evaluateSharedEvaluation(bad),/evaluator-independence-not-established/);
 }
});
test('candidate-authored self-score and fabricated summary values never override case readbacks',async()=>{
 const f=fixture();
 f.candidate.selfScore=9999;
 f.candidate.reportedScore=9999;
 f.candidate.outcomes[0]={...f.candidate.outcomes[0],passed:false};
 const r=await evaluateSharedEvaluation(f);
 assert.equal(r.candidateScore,99);
 assert.equal(r.improvementPoints,9);
});
test('score below 90 or gain below five points fails the shared performance threshold',async()=>{
 const f=fixture();
 f.candidate.outcomes=f.candidate.outcomes.map((x,i)=>({...x,passed:i>=15}));
 const bad=await evaluateSharedEvaluation(f);
 assert.ok(bad.candidateScore<90);
 assert.equal(bad.sharedThresholdMet,false);
 const little=fixture();
 little.baseline.outcomes=little.baseline.outcomes.map(x=>({...x,passed:true}));
 const noGain=await evaluateSharedEvaluation(little);
 assert.equal(noGain.improvementPoints,0);
 assert.equal(noGain.sharedThresholdMet,false);
});
test('source identity is exact and cannot reuse a baseline source as the candidate',async()=>{
 const f=fixture();
 await assert.rejects(evaluateSharedEvaluation({...f,candidate:{
  sourceSha:BASE,outcomes:results(f.cases,BASE)}}),/invalid-source-pair/);
});

test('baseline and candidate cannot share a single evidence receipt identity',async()=>{
 const f=fixture();
 f.candidate.outcomes[0]={...f.candidate.outcomes[0],receiptId:f.baseline.outcomes[0].receiptId};
 await assert.rejects(evaluateSharedEvaluation(f),/duplicate-receipt-id/);
});
test('non-string case identity is rejected before any digest sort',async()=>{
 const f=fixture();f.cases[0]={...f.cases[0],caseId:1234};
 await assert.rejects(evaluateSharedEvaluation(f),/duplicate-case-id/);
});
test('case digest is identical under a hostile ambient locale collation',async()=>{
 const f=fixture(),baseline=await evaluateSharedEvaluation(f);
 const original=String.prototype.localeCompare;
 String.prototype.localeCompare=function(other){return -original.call(this,other);};
 try{
  const changed=await evaluateSharedEvaluation(f);
  assert.equal(changed.caseDigest,baseline.caseDigest);
 }finally{String.prototype.localeCompare=original;}
});
