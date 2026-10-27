const SHA40=/^[a-f0-9]{40}$/;
const ROLES=Object.freeze([
 {role:'verifier',objective:'repo.inspect'},
 {role:'sentinel',objective:'repo.ci'},
 {role:'planner',objective:'repo.prs'},
 {role:'skeptic',objective:'site.render'}
]);
const RECEIPT_SCHEMA='ultron.council-assessment.v1';
const MAX_EVIDENCE_AGE_MS=24*60*60*1000;
const REQUIRED_WORKFLOW='Ultron core verification';
const REQUIRED_JOB='test';
const INDEPENDENT_IDENTITY_SOURCES=new Set([
 'github-review','provider-attestation','owner-observed-readback'
]);
const INDEPENDENT_READBACK_KINDS=new Set([
 'github-review-readback','provider-attestation-readback','owner-observed-readback'
]);
const TRUSTED_READBACKS=new Map([
 ['github-review',['github-review-readback','github-review-adapter']],
 ['provider-attestation',['provider-attestation-readback','provider-attestation-adapter']],
 ['owner-observed-readback',['owner-observed-readback','owner-readback-adapter']]
]);
const EXTERNAL_ACTION_STATES=new Set(['not-started','uncertain','committed','failed']);
const EXTERNAL_ACTION_READBACKS=new Set(['not-observed','committed','not-committed']);
const TRUSTED_EVALUATION_READBACK=Object.freeze({
 kind:'held-out-evaluation-readback',id:'held-out-evaluation-adapter'
});
const EVALUATION_SET_SCHEMA='ultron.held-out-evaluation-set.v1';
const INDEPENDENT_EVIDENCE_CLASS='independent-task-evaluation-v1';
const OUTCOME_SCHEMA='ultron.held-out-outcome.v1';
const HELD_OUT_OBJECTIVE='held-out.evaluate';

function iso(value){
 if(typeof value!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
  return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
function text(value,maximum=160){
 return typeof value==='string'&&value.trim()&&value.length<=maximum&&!value.includes('\0')
  ?value.trim():null;
}
function integer(value){
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
}
function nonnegativeInteger(value){
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=0?n:null;
}
function list(value,maximum=32){
 if(!Array.isArray(value)||value.length>maximum)return null;
 const normalized=[];
 for(const item of value){
  const clean=text(item,200);
  if(!clean||normalized.includes(clean))return null;
  normalized.push(clean);
 }
 return normalized.sort();
}
function idList(value,maximum=64){
 if(!Array.isArray(value)||!value.length||value.length>maximum)return null;
 const normalized=[];
 for(const item of value){
  const clean=integer(item);
  if(!clean||normalized.includes(clean))return null;
  normalized.push(clean);
 }
 return normalized;
}
function freeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);
  for(const child of Object.values(value))freeze(child);
 }
 return value;
}
function assessmentFor(role,result,sourceSha){
 if(role==='verifier'){
  const observed=SHA40.test(result?.sha||'')&&result.sha===sourceSha;
  return {assessment:observed?'current-main-observed':'main-evidence-conflict',
   recommendation:observed?'inspect-ci':'refresh-main',
   dissent:observed?[]:['source-sha-conflict']};
 }
 if(result?.source_sha!==sourceSha){
  return {assessment:'source-evidence-conflict',recommendation:'refresh-evidence',
   dissent:['source-sha-conflict']};
 }
 if(role==='sentinel'){
  if(result.complete!==true||!Array.isArray(result.runs)||!result.runs.length||
     result.runs.length>12){
   return {assessment:'ci-evidence-incomplete',recommendation:'refresh-ci',
    dissent:['ci-evidence-incomplete']};
  }
  const runs=result.runs.filter(run=>integer(run?.id)&&text(run?.name,90)&&
   ['queued','in_progress','completed'].includes(run?.status)&&
   (run.status!=='completed'||typeof run.conclusion==='string')&&
   SHA40.test(run?.head_sha||'')&&text(run?.event,40)&&iso(run?.created_at));
  if(runs.length!==result.runs.length){
   return {assessment:'ci-evidence-malformed',recommendation:'refresh-ci',
    dissent:['ci-evidence-malformed']};
  }
  const exact=runs.filter(run=>run.head_sha===sourceSha&&
   run.name===REQUIRED_WORKFLOW&&run.event==='push').sort((a,b)=>
   Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
  if(!exact.length){
   return {assessment:'exact-head-ci-missing',recommendation:'run-ci',
    dissent:['exact-head-ci-missing']};
  }
  const successful=exact[0].status==='completed'&&exact[0].conclusion==='success'&&
   exact[0].jobs_complete===true&&exact[0].required_job?.name===REQUIRED_JOB&&
   exact[0].required_job?.status==='completed'&&
   exact[0].required_job?.conclusion==='success';
  return {assessment:successful?'exact-head-ci-success':'exact-head-ci-not-successful',
   recommendation:successful?'observe':'inspect-ci',
   dissent:successful?[]:['exact-head-ci-not-successful']};
 }
 if(role==='planner'){
  const count=nonnegativeInteger(result?.count);
  const valid=count!==null&&result.partial===false;
  return {assessment:valid?'pr-inventory-observed':'pr-inventory-malformed',
   recommendation:valid?'observe':'refresh-prs',
   dissent:valid?[]:['pr-evidence-malformed']};
 }
 const rendered=result?.runtime_source_sha===sourceSha&&result?.has_app_shell===true;
 return {assessment:rendered?'site-render-observed':'site-render-unverified',
  recommendation:rendered?'observe':'render-site',
  dissent:rendered?[]:[result?.runtime_source_sha===sourceSha?
   'runtime-render-unverified':'source-sha-conflict']};
}
/**
 * Convert independently persisted task/event readbacks into deterministic
 * advisory receipts. These fixed roles are explicitly not independent
 * reviewers and cannot grant execution or release authority.
 */
export function buildCouncilAssessmentReceipts({
 objectiveId,sourceSha,observations,assessedAt,maxEvidenceAgeMs=MAX_EVIDENCE_AGE_MS
}={}){
 const objective=text(objectiveId,160),at=iso(assessedAt);
 if(!objective||!SHA40.test(sourceSha||'')||!at||!Array.isArray(observations)||
    observations.length>16||!Number.isFinite(maxEvidenceAgeMs)||maxEvidenceAgeMs<1)
  return freeze([]);
 const now=Date.parse(at),receipts=[];
 for(const profile of ROLES){
  const observed=observations.find(item=>item?.objective===profile.objective);
  const taskId=integer(observed?.taskId),receiptId=integer(observed?.receiptId);
  const evidenceObservedAt=iso(observed?.observedAt);
  if(!taskId||!receiptId||!evidenceObservedAt||
     !observed.result||typeof observed.result!=='object'||Array.isArray(observed.result))continue;
  const finding=assessmentFor(profile.role,observed.result,sourceSha);
  const freshness=now-Date.parse(evidenceObservedAt)<=maxEvidenceAgeMs&&
    now>=Date.parse(evidenceObservedAt)?'fresh':'stale';
  receipts.push({
   schema:RECEIPT_SCHEMA,
   objectiveId:objective,
   sourceSha,
   role:profile.role,
   reviewer:{kind:'deterministic-role-profile',id:'ultron-cloud-'+profile.role},
   taskIds:[taskId],
   taskReceiptIds:[receiptId],
   evidenceObservedAt,
   assessedAt:at,
   evidenceFreshness:freshness,
   assessment:finding.assessment,
   recommendation:finding.recommendation,
   dissent:finding.dissent,
   knownUnknowns:['deterministic-profile-not-independent'],
   authority:{mode:'advisory-only',executable:false,releaseAuthority:'github-protected-pr'},
   modelInvocations:0,
   creditCost:0,
   paidFallback:false
  });
 }
 return freeze(receipts);
}

function receiptProblem(receipt,{objectiveId,sourceSha,now,maxEvidenceAgeMs}){
 if(!receipt||receipt.schema!==RECEIPT_SCHEMA||receipt.objectiveId!==objectiveId||
    receipt.sourceSha!==sourceSha||!text(receipt.role,40)||
    !['deterministic-role-profile','independent-reviewer'].includes(receipt.reviewer?.kind)||
    !text(receipt.reviewer?.id,120)||!Array.isArray(receipt.taskIds)||
    !receipt.taskIds.length||receipt.taskIds.some(id=>!integer(id))||
    !Array.isArray(receipt.taskReceiptIds)||!receipt.taskReceiptIds.length||
    receipt.taskReceiptIds.some(id=>!integer(id))||!iso(receipt.evidenceObservedAt)||
    !iso(receipt.assessedAt)||!text(receipt.assessment,120)||
    !text(receipt.recommendation,120)||!list(receipt.dissent)||
    !list(receipt.knownUnknowns)||receipt.authority?.mode!=='advisory-only'||
    receipt.authority?.executable!==false||receipt.modelInvocations!==0||
    receipt.creditCost!==0||receipt.paidFallback!==false)return 'malformed-receipt';
 if(receipt.reviewer.kind==='independent-reviewer'&&
    (!INDEPENDENT_IDENTITY_SOURCES.has(receipt.reviewer.identitySource)||
     !integer(receipt.reviewer.identityReceiptId)))return 'independent-identity-unverified';
 const evidenceAt=Date.parse(receipt.evidenceObservedAt);
 const assessedAt=Date.parse(receipt.assessedAt);
 if(assessedAt<evidenceAt||assessedAt>now||now-assessedAt>maxEvidenceAgeMs)
  return 'receipt-time-invalid';
 const age=now-evidenceAt;
 if(receipt.evidenceFreshness!=='fresh'||age<0||age>maxEvidenceAgeMs)return 'stale-evidence';
 return null;
}

function attestationProblem(attestation,{objectiveId,sourceSha,now,maxEvidenceAgeMs}){
 if(!attestation||!integer(attestation.eventId)||
    attestation.eventType!=='independent-reviewer-attested'||
    attestation.objectiveId!==objectiveId||attestation.sourceSha!==sourceSha||
    !text(attestation.reviewerId,120)||
    !INDEPENDENT_IDENTITY_SOURCES.has(attestation.identitySource)||
    !iso(attestation.observedAt)||attestation.verified!==true||
    !INDEPENDENT_READBACK_KINDS.has(attestation.verifiedBy?.kind)||
    !text(attestation.verifiedBy?.id,120))return 'identity-attestation-evidence-invalid';
 const trusted=TRUSTED_READBACKS.get(attestation.identitySource);
 if(!trusted||attestation.verifiedBy.kind!==trusted[0]||
    attestation.verifiedBy.id!==trusted[1])return 'identity-attestation-evidence-invalid';
 const age=now-Date.parse(attestation.observedAt);
 if(age<0||age>maxEvidenceAgeMs)return 'identity-attestation-stale';
 return null;
}

function evaluationLineage(evaluation,{objectiveId,sourceSha,now,maxEvidenceAgeMs}){
 const taskIds=idList(evaluation?.taskIds),receiptIds=idList(evaluation?.outcomeReceiptIds);
 if(!evaluation||!integer(evaluation.eventId)||
    evaluation.eventType!=='held-out-evaluation-observed'||
    evaluation.objectiveId!==objectiveId||evaluation.sourceSha!==sourceSha||
    !iso(evaluation.observedAt)||evaluation.evaluator?.kind!=='independent-evaluator'||
    !text(evaluation.evaluator?.id,120)||
    evaluation.verifiedBy?.kind!==TRUSTED_EVALUATION_READBACK.kind||
    evaluation.verifiedBy?.id!==TRUSTED_EVALUATION_READBACK.id||
    !taskIds||!receiptIds||taskIds.length!==receiptIds.length||
    !Array.isArray(evaluation.outcomeReadbacks)||
    evaluation.outcomeReadbacks.length!==receiptIds.length)
  return {problem:'evaluation-lineage-invalid'};
 const observedAt=Date.parse(evaluation.observedAt);
 if(observedAt>now||now-observedAt>maxEvidenceAgeMs)
  return {problem:'evaluation-lineage-stale'};
 const manifest=evaluation.manifestReadback,manifestReceiptId=integer(
  evaluation.manifestReceiptId);
 if(!manifestReceiptId||manifest?.receiptId!==manifestReceiptId||
    manifest.eventType!=='held-out-evaluation-frozen'||
    manifest.schema!==EVALUATION_SET_SCHEMA||
    manifest.objectiveId!==objectiveId||manifest.sourceSha!==sourceSha||
    !text(manifest.setId,120)||!iso(manifest.observedAt)||
    manifest.frozen!==true||manifest.setsDisjoint!==true||
    !Array.isArray(manifest.cases)||!manifest.cases.length||
    manifest.cases.length>32)
  return {problem:'evaluation-manifest-invalid'};
 const manifestAt=Date.parse(manifest.observedAt);
 if(manifestAt>observedAt||manifestAt>now||now-manifestAt>maxEvidenceAgeMs)
  return {problem:'evaluation-manifest-stale'};
 const manifestTasks=new Set(),manifestCases=new Map();
 for(const item of manifest.cases){
  const caseId=text(item?.caseId,120),baselineTaskId=integer(item?.baselineTaskId);
  const candidateTaskId=integer(item?.candidateTaskId);
  if(!caseId||!baselineTaskId||!candidateTaskId||baselineTaskId===candidateTaskId||
     manifestCases.has(caseId)||manifestTasks.has(baselineTaskId)||
     manifestTasks.has(candidateTaskId))return {problem:'evaluation-manifest-invalid'};
  manifestTasks.add(baselineTaskId);manifestTasks.add(candidateTaskId);
  manifestCases.set(caseId,{baselineTaskId,candidateTaskId});
 }
 if(taskIds.length!==manifestTasks.size||taskIds.some(id=>!manifestTasks.has(id)))
  return {problem:'evaluation-lineage-invalid'};
 const pairs=new Set(),seenReceipts=new Set(),seenTasks=new Set(),results=new Map();
 for(const readback of evaluation.outcomeReadbacks){
  const receiptId=integer(readback?.receiptId),taskId=integer(readback?.taskId);
  const readAt=iso(readback?.observedAt);
  const result=readback?.result,caseId=text(result?.caseId,120);
  const variant=result?.variant;
  if(!receiptId||!taskId||readback?.eventType!=='observed'||!readAt||
     readback.taskObjective!==HELD_OUT_OBJECTIVE||
     Date.parse(readAt)<manifestAt||Date.parse(readAt)>observedAt||
     now-Date.parse(readAt)>maxEvidenceAgeMs||!receiptIds.includes(receiptId)||
     !taskIds.includes(taskId)||seenReceipts.has(receiptId)||seenTasks.has(taskId)||
     result?.schema!==OUTCOME_SCHEMA||result.objectiveId!==objectiveId||
     result.sourceSha!==sourceSha||result.setId!==manifest.setId||!caseId||
     !['baseline','candidate'].includes(variant)||
     !Number.isFinite(result.score)||result.score<0||result.score>1||
     !['passed','failed'].includes(result.status)||
     typeof result.criticalRegression!=='boolean')
   return {problem:'evaluation-lineage-invalid'};
  const expected=manifestCases.get(caseId);
  if(!expected||expected[variant+'TaskId']!==taskId||
     results.has(caseId+':'+variant))return {problem:'evaluation-lineage-invalid'};
  seenReceipts.add(receiptId);seenTasks.add(taskId);pairs.add(taskId+':'+receiptId);
  results.set(caseId+':'+variant,result);
 }
 if(pairs.size!==receiptIds.length||seenTasks.size!==taskIds.length)
  return {problem:'evaluation-lineage-invalid'};
 const baseline=[],candidate=[];
 for(const caseId of manifestCases.keys()){
  const before=results.get(caseId+':baseline'),after=results.get(caseId+':candidate');
  if(!before||!after)return {problem:'evaluation-lineage-invalid'};
  baseline.push(before);candidate.push(after);
 }
 const metrics={
  baselineScore:baseline.reduce((sum,item)=>sum+item.score,0)/baseline.length,
  candidateScore:candidate.reduce((sum,item)=>sum+item.score,0)/candidate.length,
  candidateFailures:candidate.filter(item=>item.status==='failed').length,
  criticalRegressions:candidate.filter(item=>item.criticalRegression).length
 };
 if(evaluation.baselineScore!==metrics.baselineScore||
    evaluation.candidateScore!==metrics.candidateScore||
    evaluation.candidateFailures!==metrics.candidateFailures||
    evaluation.criticalRegressions!==metrics.criticalRegressions)
  return {problem:'evaluation-score-mismatch',metrics};
 return {problem:null,metrics};
}

/**
 * Fail-closed selection gate. "eligibleForProtectedPromotion" means only that
 * evidence may enter the existing owner-approved GitHub PR path. Execution,
 * merge, deployment, and live improvement are always separate observations.
 */
export function evaluateCouncilEvidence({
 objectiveId,sourceSha,receipts=[],now,maxEvidenceAgeMs=MAX_EVIDENCE_AGE_MS,
 lease={state:'active',tokenMatches:true},provider={required:false},
 externalActions=[],evaluation=null,identityAttestations=[],
 trustedAdapterEvidence={reviewer:false,evaluation:false}
}={}){
 const reasons=new Set(),reconciledExternalActions=[],replayExternalActions=[];
 const objective=text(objectiveId,160),at=iso(now);
 if(!objective||!SHA40.test(sourceSha||'')||!at||!Array.isArray(receipts)||
    !Number.isFinite(maxEvidenceAgeMs)||maxEvidenceAgeMs<1){
  reasons.add('evaluation-contract-invalid');
 }
 const seen=new Set(),reviewers=new Set(),positions=new Map(),attestations=new Map();
 if(!Array.isArray(identityAttestations))reasons.add('identity-attestation-evidence-invalid');
 else if(objective&&SHA40.test(sourceSha||'')&&at){
  for(const attestation of identityAttestations){
   const problem=attestationProblem(attestation,{objectiveId:objective,sourceSha,
    now:Date.parse(at),maxEvidenceAgeMs});
   if(problem){reasons.add(problem);continue;}
   if(attestations.has(attestation.eventId)){
    reasons.add('identity-attestation-duplicate');continue;
   }
   attestations.set(attestation.eventId,attestation);
  }
 }
 if(!receipts.length)reasons.add('council-receipts-missing');
 if(objective&&SHA40.test(sourceSha||'')&&at&&Array.isArray(receipts)){
  for(const receipt of receipts){
   const problem=receiptProblem(receipt,{objectiveId:objective,sourceSha,
    now:Date.parse(at),maxEvidenceAgeMs});
   if(problem){reasons.add(problem);continue;}
   const key=[receipt.role,receipt.reviewer.kind,receipt.reviewer.id,
    receipt.taskReceiptIds.join(',')].join(':');
   if(seen.has(key)){reasons.add('duplicate-receipt-replay');continue;}
   seen.add(key);
   const earlier=positions.get(receipt.role);
   const position=receipt.assessment+'|'+receipt.recommendation;
   if(earlier&&earlier!==position)reasons.add('contradictory-assessment');
   positions.set(receipt.role,position);
   if(receipt.dissent.length)reasons.add('material-dissent-unresolved');
   if(receipt.reviewer.kind==='independent-reviewer'){
    const attestation=attestations.get(receipt.reviewer.identityReceiptId);
    if(!attestation||attestation.reviewerId!==receipt.reviewer.id||
       attestation.identitySource!==receipt.reviewer.identitySource){
     reasons.add('independent-identity-unverified');
    }else reviewers.add([
     receipt.reviewer.id,receipt.reviewer.identitySource,receipt.reviewer.identityReceiptId
    ].join(':'));
   }
  }
 }
 if(reviewers.size<1)reasons.add('independent-reviewer-missing');
 if(reviewers.size&&trustedAdapterEvidence?.reviewer!==true)
  reasons.add('independent-reviewer-adapter-unavailable');
 if(lease?.state!=='active'||lease?.tokenMatches!==true)reasons.add('stale-or-mismatched-lease');
 if(provider?.required===true&&
    (provider.status!=='ready'||provider.tokenPresent!==true))reasons.add('provider-not-ready');
 if(!Array.isArray(externalActions))reasons.add('external-action-evidence-invalid');
 else{
  const actionIds=new Set();
  for(const action of externalActions){
  const id=text(action?.id,120);
  if(!id||!EXTERNAL_ACTION_STATES.has(action?.state)||
     !EXTERNAL_ACTION_READBACKS.has(action?.readback)){
   reasons.add('external-action-evidence-invalid');continue;
  }
  if(actionIds.has(id)){
   reasons.add('external-action-evidence-duplicate');continue;
  }
  actionIds.add(id);
  if(action.state==='uncertain'){
   if(action.readback==='committed')reconciledExternalActions.push(id);
   else reasons.add('external-action-readback-required');
  }
  if(action.state==='committed'&&action.readback!=='committed')
   reasons.add('external-action-readback-required');
  if(action.state==='not-started'&&action.readback!=='not-observed')
   reasons.add('external-action-evidence-invalid');
  if(action.state==='failed'&&action.readback!=='not-committed')
   reasons.add('external-action-evidence-invalid');
  // External actions are never automatically replayed by this gate.
  }
 }
 if(!evaluation)reasons.add('held-out-evaluation-missing');
 else{
  if(trustedAdapterEvidence?.evaluation!==true)
   reasons.add('evaluation-adapter-unavailable');
  // Public seeded property/regression cases test the adapter. They are not
  // independently authored, held-out task outcomes, even when every case passes.
  // Require classification at BOTH persisted manifest and evaluation readback.
  if(evaluation.evidenceClass!==INDEPENDENT_EVIDENCE_CLASS ||
     evaluation.manifestReadback?.evidenceClass!==INDEPENDENT_EVIDENCE_CLASS)
   reasons.add('independent-heldout-task-evidence-required');
  const lineage=evaluationLineage(evaluation,{objectiveId:objective,
   sourceSha,now:Date.parse(at),maxEvidenceAgeMs});
  if(lineage.problem)reasons.add(lineage.problem);
  if(evaluation.frozen!==true||evaluation.setsDisjoint!==true)
   reasons.add('evaluation-not-frozen-or-disjoint');
  if(evaluation.objectiveId!==objective)reasons.add('evaluation-objective-mismatch');
  if(evaluation.sourceSha!==sourceSha)reasons.add('evaluation-source-mismatch');
  if(evaluation.runtimeSourceSha!==sourceSha)reasons.add('postmerge-source-runtime-mismatch');
  if(evaluation.independentlyObserved!==true||evaluation.outcomeReadbacksObserved!==true)
   reasons.add('outcomes-not-independently-observed');
  const metrics=lineage.metrics;
  if(!Number.isFinite(evaluation.baselineScore)||
     !Number.isFinite(evaluation.candidateScore)||
     evaluation.baselineScore<0||evaluation.baselineScore>1||
     evaluation.candidateScore<0||evaluation.candidateScore>1)
   reasons.add('evaluation-score-invalid');
  if(!metrics||!Number.isFinite(metrics.baselineScore)||
     !Number.isFinite(metrics.candidateScore))
   reasons.add('evaluation-score-invalid');
  else if(metrics.candidateScore<=metrics.baselineScore)
   reasons.add('held-out-improvement-not-observed');
  if(nonnegativeInteger(evaluation.candidateFailures)===null||
     !metrics||metrics.candidateFailures>0)
   reasons.add('held-out-candidate-failure');
  if(nonnegativeInteger(evaluation.criticalRegressions)===null||
     !metrics||metrics.criticalRegressions>0)
   reasons.add('critical-regression');
 }
 const eligibleForProtectedPromotion=reasons.size===0;
 return freeze({
  schema:'ultron.council-evidence-gate.v1',
  status:eligibleForProtectedPromotion?'eligible-for-protected-pr':'held',
  objectiveId:objective||null,
  sourceSha:SHA40.test(sourceSha||'')?sourceSha:null,
  validReceiptCount:seen.size,
  independentReviewerCount:reviewers.size,
  reasons:[...reasons].sort(),
  reconciledExternalActions:reconciledExternalActions.sort(),
  replayExternalActions,
  eligibleForProtectedPromotion,
  eligibleForExecution:false,
  authority:{mode:'advisory-only',releaseAuthority:'github-protected-pr',actionAuthority:'unchanged'}
 });
}

