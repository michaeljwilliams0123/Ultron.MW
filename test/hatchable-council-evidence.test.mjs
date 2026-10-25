import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
 buildCouncilAssessmentReceipts,evaluateCouncilEvidence
} from '../cloud/hatchable/lib/council-evidence.js';

async function coreUnderTest(){
 const evidenceSource=await readFile(new URL('../cloud/hatchable/lib/council-evidence.js',
  import.meta.url),'utf8');
 const evidenceUrl='data:text/javascript;base64,'+
  Buffer.from(evidenceSource).toString('base64');
 const acceptanceSource=await readFile(new URL('../cloud/hatchable/lib/acceptance-evidence.js',
  import.meta.url),'utf8');
 const acceptanceUrl='data:text/javascript;base64,'+
  Buffer.from(acceptanceSource).toString('base64');
 const coreSource=await readFile(new URL('../cloud/hatchable/lib/brain-core.js',
  import.meta.url),'utf8');
 const coreUrl='data:text/javascript;base64,'+Buffer.from(coreSource.replace(
  "from 'lib/council-evidence.js'","from '"+evidenceUrl+"'"
 ).replace("from 'lib/acceptance-evidence.js'","from '"+acceptanceUrl+"'"
 )).toString('base64');
 return import(coreUrl);
}

const SHA='a'.repeat(40),OTHER_SHA='b'.repeat(40);
const NOW='2026-10-24T12:00:00.000Z';
const OBSERVED='2026-10-24T11:00:00.000Z';
const MANIFEST_OBSERVED='2026-10-24T10:30:00.000Z';
const OBJECTIVE='council-cycle-001';
function observations(){
 return [
  {taskId:1,receiptId:101,objective:'repo.inspect',observedAt:OBSERVED,
   result:{sha:SHA}},
  {taskId:2,receiptId:102,objective:'repo.ci',observedAt:OBSERVED,
   result:{source_sha:SHA,complete:true,runs:[{id:401,
    name:'Ultron core verification',status:'completed',conclusion:'success',
    head_sha:SHA,event:'push',created_at:OBSERVED,jobs_complete:true,
    required_job:{name:'test',status:'completed',conclusion:'success'}}]}},
  {taskId:3,receiptId:103,objective:'repo.prs',observedAt:OBSERVED,
   result:{source_sha:SHA,count:0,partial:false}},
  {taskId:4,receiptId:104,objective:'site.render',observedAt:OBSERVED,
   result:{source_sha:SHA,runtime_source_sha:SHA,has_app_shell:true}}
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
function attestation(overrides={}){
 return {eventId:901,eventType:'independent-reviewer-attested',objectiveId:OBJECTIVE,
  sourceSha:SHA,reviewerId:'external-reviewer-1',identitySource:'github-review',
  observedAt:OBSERVED,verified:true,
  verifiedBy:{kind:'github-review-readback',id:'github-review-adapter'},...overrides};
}
function manifestReadback(overrides={}){
 return {receiptId:903,eventType:'held-out-evaluation-frozen',
  schema:'ultron.held-out-evaluation-set.v1',objectiveId:OBJECTIVE,
  sourceSha:SHA,setId:'held-out-set-1',observedAt:MANIFEST_OBSERVED,
  frozen:true,setsDisjoint:true,cases:[{
   caseId:'case-1',baselineTaskId:21,candidateTaskId:22
  }],...overrides};
}
function outcomeReadbacks(){
 return [
  {receiptId:904,taskId:21,eventType:'observed',observedAt:OBSERVED,
   taskObjective:'held-out.evaluate',result:{schema:'ultron.held-out-outcome.v1',
    objectiveId:OBJECTIVE,sourceSha:SHA,setId:'held-out-set-1',caseId:'case-1',
    variant:'baseline',score:.5,status:'passed',criticalRegression:false}},
  {receiptId:905,taskId:22,eventType:'observed',observedAt:OBSERVED,
   taskObjective:'held-out.evaluate',result:{schema:'ultron.held-out-outcome.v1',
    objectiveId:OBJECTIVE,sourceSha:SHA,setId:'held-out-set-1',caseId:'case-1',
    variant:'candidate',score:.7,status:'passed',criticalRegression:false}}
 ];
}
function evaluation(overrides={}){
 return {objectiveId:OBJECTIVE,frozen:true,setsDisjoint:true,
  sourceSha:SHA,runtimeSourceSha:SHA,
  independentlyObserved:true,outcomeReadbacksObserved:true,
  eventId:906,eventType:'held-out-evaluation-observed',observedAt:OBSERVED,
  evaluator:{kind:'independent-evaluator',id:'held-out-evaluator-1'},
  verifiedBy:{kind:'held-out-evaluation-readback',
   id:'held-out-evaluation-adapter'},
  manifestReceiptId:903,manifestReadback:manifestReadback(),
  taskIds:[21,22],outcomeReceiptIds:[904,905],
  outcomeReadbacks:outcomeReadbacks(),
  baselineScore:.5,candidateScore:.7,candidateFailures:0,criticalRegressions:0,
  ...overrides};
}
function ready(overrides={}){
 const profiles=deterministicReceipts();
 return evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,now:NOW,
  receipts:[...profiles,independent(profiles[0])],evaluation:evaluation(),
  identityAttestations:[attestation()],trustedAdapterEvidence:{
   reviewer:true,evaluation:true
  },...overrides});
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
 const claimed=independent(deterministicReceipts()[0]);
 const noReadback=evaluateCouncilEvidence({objectiveId:OBJECTIVE,sourceSha:SHA,
  receipts:[claimed],now:NOW,evaluation:evaluation()});
 assert.ok(noReadback.reasons.includes('independent-identity-unverified'));
 assert.equal(noReadback.independentReviewerCount,0);
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

test('role evidence must be bound to the exact source and successful current-head CI',()=>{
 const wrong=observations();
 wrong[1]={...wrong[1],result:{...wrong[1].result,source_sha:OTHER_SHA}};
 wrong[2]={...wrong[2],result:{...wrong[2].result,source_sha:OTHER_SHA}};
 wrong[3]={...wrong[3],result:{...wrong[3].result,runtime_source_sha:OTHER_SHA}};
 const wrongReceipts=buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,
  sourceSha:SHA,observations:wrong,assessedAt:NOW});
 assert.ok(wrongReceipts.filter(x=>x.role!=='verifier')
  .every(x=>x.dissent.includes('source-sha-conflict')));

 for(const conclusion of ['action_required','cancelled','timed_out',null]){
  const current=observations();
  current[1]={...current[1],result:{...current[1].result,runs:[{
   ...current[1].result.runs[0],status:conclusion===null?'in_progress':'completed',
   conclusion
  }]}};
  const sentinel=buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,
   sourceSha:SHA,observations:current,assessedAt:NOW}).find(x=>x.role==='sentinel');
  assert.ok(sentinel.dissent.includes('exact-head-ci-not-successful'));
 }
 const incomplete=observations();
 incomplete[1]={...incomplete[1],result:{...incomplete[1].result,complete:false}};
 const sentinel=buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,
  sourceSha:SHA,observations:incomplete,assessedAt:NOW}).find(x=>x.role==='sentinel');
 assert.ok(sentinel.dissent.includes('ci-evidence-incomplete'));
});

test('hosted CI observation rechecks main and binds the required workflow job',async()=>{
 const {executeObjective}=await coreUnderTest();
 const originalFetch=globalThis.fetch;
 let mainReads=0,moveMain=false;
 globalThis.fetch=async url=>({ok:true,json:async()=>{
  const value=String(url);
  if(value.includes('/git/ref/heads/main')){
   mainReads++;
   return {object:{sha:moveMain&&mainReads>1?OTHER_SHA:SHA}};
  }
  if(value.includes('/actions/runs/401/jobs'))return {total_count:1,jobs:[{
   name:'test',status:'completed',conclusion:'success'
  }]};
  if(value.includes('/actions/runs?'))return {total_count:1,workflow_runs:[{
   id:401,name:'Ultron core verification',status:'completed',conclusion:'success',
   head_sha:SHA,event:'push',created_at:OBSERVED,html_url:'https://example.invalid/run'
  }]};
  throw Error('unexpected-url');
 }});
 try{
  const result=await executeObjective('repo.ci',{db:{},browser:{}});
  assert.equal(result.source_sha,SHA);
  assert.equal(result.complete,true);
  assert.deepEqual(result.runs[0].required_job,{
   name:'test',status:'completed',conclusion:'success'
  });
  assert.equal(mainReads,2);
  moveMain=true;mainReads=0;
  await assert.rejects(executeObjective('repo.ci',{db:{},browser:{}}),
   /main-moved-during-observation/);
 }finally{globalThis.fetch=originalFetch;}
});

test('receipt and attestation time or adapter forgeries fail closed',()=>{
 const profiles=deterministicReceipts();
 const early=independent({...profiles[0],assessedAt:'2026-10-24T10:00:00.000Z'});
 const earlyGate=ready({receipts:[...profiles,early]});
 assert.ok(earlyGate.reasons.includes('receipt-time-invalid'));
 const forged=ready({identityAttestations:[attestation({
  verifiedBy:{kind:'github-review-readback',id:'attacker-selected-adapter'}
 })]});
 assert.ok(forged.reasons.includes('identity-attestation-evidence-invalid'));
 assert.equal(forged.eligibleForProtectedPromotion,false);
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

test('held-out evaluation requires durable fresh outcome lineage and trusted readback',()=>{
 const missing=ready({evaluation:evaluation({outcomeReadbacks:[]})});
 assert.ok(missing.reasons.includes('evaluation-lineage-invalid'));
 const forged=ready({evaluation:evaluation({
  verifiedBy:{kind:'held-out-evaluation-readback',id:'self-asserted-adapter'}
 })});
 assert.ok(forged.reasons.includes('evaluation-lineage-invalid'));
 const duplicate=ready({evaluation:evaluation({outcomeReceiptIds:[904,904]})});
 assert.ok(duplicate.reasons.includes('evaluation-lineage-invalid'));
 const stale=ready({evaluation:evaluation({observedAt:'2026-10-22T11:00:00.000Z'})});
 assert.ok(stale.reasons.includes('evaluation-lineage-stale'));
 const unrelated=outcomeReadbacks();
 unrelated[1]={...unrelated[1],taskObjective:'repo.inspect',
  result:{sha:SHA}};
 const unrelatedGate=ready({evaluation:evaluation({outcomeReadbacks:unrelated})});
 assert.ok(unrelatedGate.reasons.includes('evaluation-lineage-invalid'));
 const invented=ready({evaluation:evaluation({candidateScore:.9})});
 assert.ok(invented.reasons.includes('evaluation-score-mismatch'));
});

test('lost write response with committed readback reconciles without replay',()=>{
 const report=ready({externalActions:[{id:'github-write-1',state:'uncertain',
  readback:'committed'}]});
 assert.equal(report.eligibleForProtectedPromotion,true);
 assert.deepEqual(report.reconciledExternalActions,['github-write-1']);
 assert.deepEqual(report.replayExternalActions,[]);
 assert.equal(report.eligibleForExecution,false);
});

test('unknown or duplicate external actions and negative result counts fail closed',()=>{
 const unknown=ready({externalActions:[{id:'github-write-1',state:'invented',
  readback:'committed'}]});
 assert.ok(unknown.reasons.includes('external-action-evidence-invalid'));
 const duplicate=ready({externalActions:[
  {id:'github-write-1',state:'committed',readback:'committed'},
  {id:'github-write-1',state:'committed',readback:'committed'}
 ]});
 assert.ok(duplicate.reasons.includes('external-action-evidence-duplicate'));
 const negative=ready({evaluation:evaluation({candidateFailures:-1,
  criticalRegressions:-1})});
 assert.ok(negative.reasons.includes('held-out-candidate-failure'));
 assert.ok(negative.reasons.includes('critical-regression'));
 assert.equal(negative.eligibleForProtectedPromotion,false);
});

test('held-out failure and postmerge source/runtime mismatch remain blocked',()=>{
 const failedOutcomes=outcomeReadbacks();
 failedOutcomes[1]={...failedOutcomes[1],result:{...failedOutcomes[1].result,
  status:'failed'}};
 const failed=ready({evaluation:evaluation({candidateFailures:1,
  outcomeReadbacks:failedOutcomes})});
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
 const {executeObjective}=await coreUnderTest();
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{
  assert.match(String(url),/\/git\/ref\/heads\/main$/);
  return {ok:true,json:async()=>({object:{sha:SHA}})};
 };
 const rows=observations().map(item=>({id:item.taskId,task_key:'task-'+item.taskId,
  objective:item.objective,status:'done',last_result:item.result,
  updated_at:item.observedAt,receipt_id:item.receiptId}));
 rows[0].last_result={sha:OTHER_SHA};
 try{
  const result=await executeObjective('council.review',{
   db:{query:async sql=>({rows:sql.includes('FROM brain_tasks')?rows:[]})},
   browser:{},task:{taskKey:OBJECTIVE}
  });
  assert.equal(result.assessment_receipts.length,4);
  assert.deepEqual(result.assessment_receipts.map(x=>x.taskReceiptIds[0]),
   [101,102,103,104]);
  assert.equal(result.source_sha,SHA);
  assert.ok(result.assessment_receipts.find(x=>x.role==='verifier')
   .dissent.includes('source-sha-conflict'));
  assert.equal(result.promotion_gate.eligibleForProtectedPromotion,false);
  assert.ok(result.promotion_gate.reasons.includes('independent-reviewer-missing'));
  assert.ok(result.promotion_gate.reasons.includes('held-out-evaluation-missing'));
  assert.equal(result.disposition,'proposals-only-no-write-or-model-inference');
 }finally{globalThis.fetch=originalFetch;}
});

test('hosted council reads independent receipts, attestations and evaluation from distinct ledger events',async()=>{
 const {executeObjective}=await coreUnderTest();
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{
  assert.match(String(url),/\/git\/ref\/heads\/main$/);
  return {ok:true,json:async()=>({object:{sha:SHA}})};
 };
 const assessedAt=new Date().toISOString();
 const observedAt=new Date(Date.parse(assessedAt)-60_000).toISOString();
 const live=observations().map(item=>({...item,observedAt,
  result:{...item.result}}));
 live[1].result.runs=live[1].result.runs.map(run=>({...run,created_at:observedAt}));
 const recent=live.map(item=>({id:item.taskId,task_key:'task-'+item.taskId,
  objective:item.objective,status:'done',last_result:item.result,
  updated_at:item.observedAt,receipt_id:item.receiptId}));
 const profiles=buildCouncilAssessmentReceipts({objectiveId:OBJECTIVE,sourceSha:SHA,
  observations:live,assessedAt});
 const independentRow={id:902,task_id:9,created_at:assessedAt,
  details:independent(profiles[0])};
 const identityRow={id:901,created_at:observedAt,details:{objectiveId:OBJECTIVE,
  sourceSha:SHA,reviewerId:'external-reviewer-1',identitySource:'github-review',
  verified:true,verifiedBy:{kind:'github-review-readback',id:'github-review-adapter'}}};
 const evaluationRow={id:906,created_at:assessedAt,details:evaluation()};
 const manifest={...manifestReadback(),observedAt};
 const {receiptId:manifestId,eventType:manifestType,
  observedAt:manifestAt,...manifestDetails}=manifest;
 const manifestRow={id:manifestId,event_type:manifestType,
  created_at:manifestAt,details:manifestDetails};
 const outcomeRows=[
  {id:904,task_id:21,event_type:'observed',created_at:observedAt,
   task_objective:'held-out.evaluate',last_result:outcomeReadbacks()[0].result},
  {id:905,task_id:22,event_type:'observed',created_at:observedAt,
   task_objective:'held-out.evaluate',last_result:outcomeReadbacks()[1].result}
 ];
 const unrelated={id:999,task_id:999,created_at:assessedAt,
  details:{objectiveId:'other-objective',sourceSha:OTHER_SHA}};
 const db={query:async (sql,params)=>{
  if(sql.includes('FROM brain_tasks'))return {rows:recent};
  if(sql.includes("details->>'objectiveId'")){
   assert.match(sql,/details->>'objectiveId'=\$1/);
   assert.match(sql,/details->>'sourceSha'=\$2/);
   assert.deepEqual(params,[OBJECTIVE,SHA]);
  }
  if(sql.includes("event_type='independent-reviewer-attested'"))
   return {rows:[unrelated,identityRow]};
  if(sql.includes("event_type='independent-reviewer-assessment'"))
   return {rows:[unrelated,independentRow]};
  if(sql.includes("event_type='held-out-evaluation-observed'"))
   return {rows:[unrelated,evaluationRow]};
  if(sql.includes("event_type='held-out-evaluation-frozen'"))
   return {rows:[manifestRow]};
  if(sql.includes("e.event_type='observed' AND e.id = ANY"))
   return {rows:outcomeRows};
  throw Error('unexpected-sql');
 }};
 try{
  const result=await executeObjective('council.review',{
   db,browser:{},task:{taskKey:OBJECTIVE}
  });
  assert.equal(result.promotion_gate.independentReviewerCount,1);
  assert.equal(result.promotion_gate.eligibleForProtectedPromotion,false);
  assert.ok(result.promotion_gate.reasons.includes(
   'independent-reviewer-adapter-unavailable'));
  assert.ok(result.promotion_gate.reasons.includes('evaluation-adapter-unavailable'));
  assert.equal(result.promotion_gate.eligibleForExecution,false);
 }finally{globalThis.fetch=originalFetch;}
});

test('hosted council rejects a main change during its evaluation',async()=>{
 const {executeObjective}=await coreUnderTest();
 const originalFetch=globalThis.fetch;
 let reads=0;
 globalThis.fetch=async()=>({ok:true,json:async()=>({object:{
  sha:++reads===1?SHA:OTHER_SHA
 }})});
 try{
  await assert.rejects(executeObjective('council.review',{
   db:{query:async()=>({rows:[]})},browser:{},task:{taskKey:OBJECTIVE}
  }),/main-moved-during-council-evaluation/);
 }finally{globalThis.fetch=originalFetch;}
});
