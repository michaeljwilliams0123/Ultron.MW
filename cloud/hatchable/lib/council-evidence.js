const SHA40=/^[a-f0-9]{40}$/;
const ROLES=Object.freeze([
 {role:'verifier',objective:'repo.inspect'},
 {role:'sentinel',objective:'repo.ci'},
 {role:'planner',objective:'repo.prs'},
 {role:'skeptic',objective:'site.render'}
]);
const RECEIPT_SCHEMA='ultron.council-assessment.v1';
const MAX_EVIDENCE_AGE_MS=24*60*60*1000;
const INDEPENDENT_IDENTITY_SOURCES=new Set([
 'github-review','provider-attestation','owner-observed-readback'
]);
const INDEPENDENT_READBACK_KINDS=new Set([
 'github-review-readback','provider-attestation-readback','owner-observed-readback'
]);

function iso(value){
 const parsed=Date.parse(value);
 if(typeof value!=='string'||!Number.isFinite(parsed)||new Date(parsed).toISOString()!==value)
  return null;
 return value;
}
function text(value,maximum=160){
 return typeof value==='string'&&value.trim()&&value.length<=maximum&&!value.includes('\0')
  ?value.trim():null;
}
function integer(value){
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
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
 if(role==='sentinel'){
  const runs=Array.isArray(result?.runs)?result.runs:[];
  const failed=runs.filter(run=>run?.conclusion==='failure').length;
  return {assessment:failed?'recent-failing-runs':'no-observed-failing-runs',
   recommendation:failed?'inspect-ci':'observe',
   dissent:failed?['ci-failure-observed']:[]};
 }
 if(role==='planner'){
  const count=Number.isSafeInteger(result?.count)?result.count:null;
  return {assessment:count===null?'pr-inventory-malformed':'pr-inventory-observed',
   recommendation:count===null?'refresh-prs':'observe',
   dissent:count===null?['pr-evidence-malformed']:[]};
 }
 const rendered=result?.has_app_shell===true;
 return {assessment:rendered?'site-render-observed':'site-render-unverified',
  recommendation:rendered?'observe':'render-site',
  dissent:rendered?[]:['runtime-render-unverified']};
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
 const age=now-Date.parse(receipt.evidenceObservedAt);
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
 const age=now-Date.parse(attestation.observedAt);
 if(age<0||age>maxEvidenceAgeMs)return 'identity-attestation-stale';
 return null;
}

/**
 * Fail-closed selection gate. "eligibleForProtectedPromotion" means only that
 * evidence may enter the existing owner-approved GitHub PR path. Execution,
 * merge, deployment, and live improvement are always separate observations.
 */
export function evaluateCouncilEvidence({
 objectiveId,sourceSha,receipts=[],now,maxEvidenceAgeMs=MAX_EVIDENCE_AGE_MS,
 lease={state:'active',tokenMatches:true},provider={required:false},
 externalActions=[],evaluation=null,identityAttestations=[]
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
 if(lease?.state!=='active'||lease?.tokenMatches!==true)reasons.add('stale-or-mismatched-lease');
 if(provider?.required===true&&
    (provider.status!=='ready'||provider.tokenPresent!==true))reasons.add('provider-not-ready');
 if(!Array.isArray(externalActions))reasons.add('external-action-evidence-invalid');
 else for(const action of externalActions){
  const id=text(action?.id,120);
  if(!id){reasons.add('external-action-evidence-invalid');continue;}
  if(action.state==='uncertain'){
   if(action.readback==='committed')reconciledExternalActions.push(id);
   else reasons.add('external-action-readback-required');
  }
  if(action.state==='committed'&&action.readback!=='committed')
   reasons.add('external-action-readback-required');
  // External actions are never automatically replayed by this gate.
 }
 if(!evaluation)reasons.add('held-out-evaluation-missing');
 else{
  if(evaluation.frozen!==true||evaluation.setsDisjoint!==true)
   reasons.add('evaluation-not-frozen-or-disjoint');
  if(evaluation.sourceSha!==sourceSha)reasons.add('evaluation-source-mismatch');
  if(evaluation.runtimeSourceSha!==sourceSha)reasons.add('postmerge-source-runtime-mismatch');
  if(evaluation.independentlyObserved!==true||evaluation.outcomeReadbacksObserved!==true)
   reasons.add('outcomes-not-independently-observed');
  if(!Number.isFinite(evaluation.baselineScore)||!Number.isFinite(evaluation.candidateScore)||
     evaluation.baselineScore<0||evaluation.baselineScore>1||
     evaluation.candidateScore<0||evaluation.candidateScore>1)
   reasons.add('evaluation-score-invalid');
  else if(evaluation.candidateScore<=evaluation.baselineScore)
   reasons.add('held-out-improvement-not-observed');
  if(!Number.isSafeInteger(evaluation.candidateFailures)||evaluation.candidateFailures>0)
   reasons.add('held-out-candidate-failure');
  if(!Number.isSafeInteger(evaluation.criticalRegressions)||evaluation.criticalRegressions>0)
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

