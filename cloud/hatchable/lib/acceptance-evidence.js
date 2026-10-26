const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const REVIEWER={login:'coderabbitai[bot]',id:136622811,type:'Bot'};
const SHA40=/^[a-f0-9]{40}$/;
const OBJECTIVE=/^[a-z0-9][a-z0-9-]{5,79}$/;
const MANIFEST_SCHEMA='ultron.github-review-proxy-manifest.v1';
// GitHub review-count deltas are correlated advisory proxies, not held-out outcomes.
const PROXY_CLASS='advisory-review-count-proxy';
const SET_SCHEMA='ultron.github-review-proxy-set.v1';
const OUTCOME_SCHEMA='ultron.github-review-proxy-outcome.v1';
const MARKER=/<!-- ultron-review-proxy-manifest:v1\s*\n([\s\S]*?)\n-->/;
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'UltronMW-Acceptance-Adapter'};

function integer(value){
 return Number.isSafeInteger(value)&&value>0?value:null;
}
function iso(value){
 if(typeof value!=='string')return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
async function get(path,fetchImpl){
 const response=await fetchImpl(REPO+path,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('github-status-'+response.status);
 return response.json();
}
function manifestFrom(comments,{objectiveId,candidatePullNumber,candidateHeadSha}){
 if(!Array.isArray(comments)||comments.length>=100)throw Error('invalid-manifest-comments');
 const matches=[];
 for(const comment of comments){
  const marker=typeof comment?.body==='string'?comment.body.match(MARKER):null;
  if(!marker)continue;
  let value;
  try{value=JSON.parse(marker[1]);}catch{continue;}
  if(value?.schema!==MANIFEST_SCHEMA||value.objectiveId!==objectiveId||
     value.candidatePullNumber!==candidatePullNumber||
     value.candidateHeadSha!==candidateHeadSha||
     typeof value.baselinePullNumber!=='number'||!integer(value.baselinePullNumber)||
     value.baselinePullNumber===candidatePullNumber||
     value.frozen!==true||value.setsDisjoint!==false||
     value.evaluator!=='github-review-actionable-findings-v1'||
     value.scoring!=='1/(1+actionable-comments)'||
     comment.user?.login!==OWNER||comment.author_association!=='OWNER'||
     !integer(comment.id)||!iso(comment.created_at)||
     iso(comment.updated_at)!==iso(comment.created_at))continue;
  matches.push({comment,value});
 }
 if(matches.length!==1)throw Error(matches.length?'ambiguous-review-proxy-manifest':'review-proxy-manifest-missing');
 return matches[0];
}
function generatedReviews(reviews,{headSha=null,after=null}={}){
 if(!Array.isArray(reviews)||reviews.length>=100)throw Error('invalid-review-response');
 return reviews.filter(review=>{
  const body=typeof review?.body==='string'?review.body:'';
  const submitted=iso(review?.submitted_at);
  return integer(review?.id)&&review.user?.login===REVIEWER.login&&
   review.user?.id===REVIEWER.id&&review.user?.type===REVIEWER.type&&
   ['COMMENTED','APPROVED','CHANGES_REQUESTED'].includes(review.state)&&
   body.includes('<!-- coderabbit-ai-generated:v1 -->')&&
   submitted&&
   (!headSha||review.commit_id===headSha)&&(!after||Date.parse(submitted)>Date.parse(after));
 });
}
function actionable(reviews){
 const counts=reviews.map(review=>{
  // Quiet-mode CodeRabbit submissions can omit the count. Identity and
  // exact-head review evidence remain usable, but a missing count is unknown.
  const matches=[...review.body.matchAll(/Actionable comments posted:\s*(\d+)\b/g)];
  if(matches.length!==1)return null;
  const count=Number(matches[0][1]);
  return Number.isSafeInteger(count)?count:null;
 });
 return counts.every(count=>count!==null)?
  counts.reduce((sum,count)=>sum+count,0):null;
}
function score(count){return count===null?null:1/(1+count);}

/** Read a frozen public manifest and independently submitted GitHub reviews. */
export async function observeAcceptanceEvidence({
 objectiveId,candidatePullNumber,sourceSha=null,fetchImpl=fetch
}={}){
 if(!OBJECTIVE.test(objectiveId||'')||
    typeof candidatePullNumber!=='number'||!integer(candidatePullNumber)||
    (sourceSha!==null&&!SHA40.test(sourceSha)))throw Error('invalid-acceptance-request');
 const [ref,candidate,comments,candidateReviews]=await Promise.all([
  get('/git/ref/heads/main',fetchImpl),
  get('/pulls/'+candidatePullNumber,fetchImpl),
  get('/issues/'+candidatePullNumber+'/comments?per_page=100',fetchImpl),
  get('/pulls/'+candidatePullNumber+'/reviews?per_page=100',fetchImpl)
 ]);
 const currentSha=ref?.object?.sha;
 if(!SHA40.test(currentSha||'')||(sourceSha&&sourceSha!==currentSha))
  throw Error('source-sha-mismatch');
 if(candidate?.number!==candidatePullNumber||!SHA40.test(candidate?.head?.sha||'')||
    candidate.user?.login!==OWNER||candidate.merged!==true||
    candidate.merge_commit_sha!==currentSha)throw Error('candidate-not-current-merged-pr');
 const {comment:freezeComment,value:manifest}=manifestFrom(comments,{objectiveId,
  candidatePullNumber,candidateHeadSha:candidate.head.sha});
 const [currentCommit,headCommit,baseline,baselineReviews]=await Promise.all([
  get('/commits/'+currentSha,fetchImpl),get('/commits/'+candidate.head.sha,fetchImpl),
  get('/pulls/'+manifest.baselinePullNumber,fetchImpl),
  get('/pulls/'+manifest.baselinePullNumber+'/reviews?per_page=100',fetchImpl)
 ]);
 if(!SHA40.test(currentCommit?.commit?.tree?.sha||'')||
    currentCommit.commit.tree.sha!==headCommit?.commit?.tree?.sha)
  throw Error('reviewed-tree-not-current-main');
 if(baseline?.number!==manifest.baselinePullNumber||baseline.merged!==true||
    !SHA40.test(baseline?.head?.sha||''))throw Error('baseline-invalid');
 const before=generatedReviews(baselineReviews);
 const after=generatedReviews(candidateReviews,{headSha:candidate.head.sha,
  after:freezeComment.created_at});
 if(!before.length)throw Error('baseline-review-missing');
 if(after.length!==1)throw Error(after.length?'ambiguous-candidate-review':'candidate-review-missing');
 const review=after[0],baselineActionable=actionable(before);
 const candidateActionable=actionable(after);
 const frozenAt=iso(freezeComment.created_at),reviewedAt=iso(review.submitted_at);
 if(Date.parse(frozenAt)>=Date.parse(reviewedAt))throw Error('manifest-not-frozen-before-review');
 const reviewerId='github:'+review.user.login+':'+review.user.id;
 return Object.freeze({objectiveId,sourceSha:currentSha,candidatePullNumber,
  candidateHeadSha:candidate.head.sha,baselinePullNumber:baseline.number,
  reviewerId,reviewId:review.id,reviewState:review.state,reviewedAt,
  freezeCommentId:freezeComment.id,frozenAt,
  setId:'github-review-'+baseline.number+'-'+candidatePullNumber,
  baselineActionable,candidateActionable,
  baselineScore:score(baselineActionable),candidateScore:score(candidateActionable)});
}

export function reviewEvidenceProjection(observed){
 const key='acceptance:'+observed.objectiveId+':'+observed.sourceSha;
 const baselineResult={schema:OUTCOME_SCHEMA,objectiveId:observed.objectiveId,
  sourceSha:observed.sourceSha,setId:observed.setId,caseId:'github-review-findings',
  variant:'baseline',score:observed.baselineScore,
  status:observed.baselineActionable===null?'count-unavailable':'observed',
  evidenceClass:PROXY_CLASS,criticalRegression:null,
  reviewPullNumber:observed.baselinePullNumber};
 // A GitHub CHANGES_REQUESTED review is a material hold even when a
 // review bot's advisory actionable-comment count is zero or omitted.
 const changesRequested=observed.reviewState==='CHANGES_REQUESTED';
 const candidateClear=!changesRequested&&observed.candidateActionable===0;
 const candidateUnknown=observed.candidateActionable===null;
 const countUnknown=candidateUnknown||observed.baselineActionable===null;
 const candidateResult={schema:OUTCOME_SCHEMA,objectiveId:observed.objectiveId,
  sourceSha:observed.sourceSha,setId:observed.setId,caseId:'github-review-findings',
  variant:'candidate',score:observed.candidateScore,
  status:observed.candidateActionable===null?'count-unavailable':'observed',
  evidenceClass:PROXY_CLASS,criticalRegression:null,
  reviewPullNumber:observed.candidatePullNumber,reviewId:observed.reviewId,
  reviewSubmittedAt:observed.reviewedAt};
 const manifest={schema:SET_SCHEMA,objectiveId:observed.objectiveId,
  sourceSha:observed.sourceSha,setId:observed.setId,frozen:true,setsDisjoint:false,
  evidenceClass:PROXY_CLASS,freezeCommentId:observed.freezeCommentId,
  frozenAt:observed.frozenAt,
  candidateHeadSha:observed.candidateHeadSha,
  adapterKey:key+':manifest'};
 const identity={objectiveId:observed.objectiveId,sourceSha:observed.sourceSha,
  reviewerId:observed.reviewerId,identitySource:'github-review',verified:true,
  verifiedBy:{kind:'github-review-readback',id:'github-review-adapter'},
  candidatePullNumber:observed.candidatePullNumber,reviewId:observed.reviewId,
  adapterKey:key+':identity'};
 const assessment={schema:'ultron.council-assessment.v1',
  objectiveId:observed.objectiveId,sourceSha:observed.sourceSha,role:'independent',
  reviewer:{kind:'independent-reviewer',id:observed.reviewerId,
   identitySource:'github-review'},evidenceObservedAt:observed.reviewedAt,
  evidenceFreshness:'fresh',
  assessment:changesRequested?'independent-review-findings':
   candidateUnknown?'independent-review-unquantified':
   candidateClear?'independent-review-clear':'independent-review-findings',
  recommendation:changesRequested?'repair-findings':
   candidateUnknown?'manual-review-required':
   candidateClear?'observe':'repair-findings',
  dissent:changesRequested?['independent-review-changes-requested',
   ...(candidateUnknown?['review-actionable-count-unavailable']:[])]:
   candidateUnknown?['review-actionable-count-unavailable']:
   candidateClear?[]:['independent-review-findings'],
  knownUnknowns:['github-review-is-advisory','review-count-not-held-out-evaluation',
   ...(countUnknown?['review-actionable-count-unavailable']:[])],
  authority:{mode:'advisory-only',executable:false,releaseAuthority:'github-protected-pr'},
  modelInvocations:0,creditCost:0,paidFallback:false,
  candidatePullNumber:observed.candidatePullNumber,reviewId:observed.reviewId,
  adapterKey:key+':assessment'};
 const evaluation={objectiveId:observed.objectiveId,sourceSha:observed.sourceSha,
  runtimeSourceSha:observed.sourceSha,frozen:true,setsDisjoint:false,
  evidenceClass:PROXY_CLASS,independentlyObserved:false,outcomeReadbacksObserved:true,
  evaluator:{kind:'advisory-proxy',id:'github-review-count-proxy'},
  verifiedBy:{kind:'github-review-proxy',id:'github-review-count-proxy'},
  baselineScore:observed.baselineScore,candidateScore:observed.candidateScore,
  candidateFailures:null,criticalRegressions:null,
  candidatePullNumber:observed.candidatePullNumber,
  baselinePullNumber:observed.baselinePullNumber,reviewId:observed.reviewId,
  freezeCommentId:observed.freezeCommentId,adapterKey:key+':evaluation'};
 return {key,baselineResult,candidateResult,manifest,identity,assessment,evaluation};
}

const PERSIST_SQL=`WITH baseline_task AS (
 INSERT INTO brain_tasks(task_key,objective,status,attempts,max_attempts,last_result)
 VALUES($1,'held-out.evaluate','done',1,1,$2::jsonb)
 ON CONFLICT(task_key) DO UPDATE SET task_key=EXCLUDED.task_key
 WHERE brain_tasks.objective=EXCLUDED.objective AND brain_tasks.last_result=EXCLUDED.last_result
 RETURNING id
), candidate_task AS (
 INSERT INTO brain_tasks(task_key,objective,status,attempts,max_attempts,last_result)
 VALUES($3,'held-out.evaluate','done',1,1,$4::jsonb)
 ON CONFLICT(task_key) DO UPDATE SET task_key=EXCLUDED.task_key
 WHERE brain_tasks.objective=EXCLUDED.objective AND brain_tasks.last_result=EXCLUDED.last_result
 RETURNING id
), manifest_insert AS (
 INSERT INTO brain_events(event_type,details,created_at)
 SELECT 'held-out-evaluation-frozen',$5::jsonb || jsonb_build_object('cases',
  jsonb_build_array(jsonb_build_object('caseId','github-review-findings',
   'baselineTaskId',baseline_task.id,'candidateTaskId',candidate_task.id))),
  ($5::jsonb->>'frozenAt')::timestamptz
 FROM baseline_task,candidate_task ON CONFLICT DO NOTHING RETURNING id
), manifest AS (
 SELECT id FROM manifest_insert
 UNION ALL
 SELECT e.id FROM brain_events e,baseline_task,candidate_task
 WHERE e.event_type='held-out-evaluation-frozen' AND e.details->>'adapterKey'=$6
  AND e.details=($5::jsonb || jsonb_build_object('cases',
   jsonb_build_array(jsonb_build_object('caseId','github-review-findings',
    'baselineTaskId',baseline_task.id,'candidateTaskId',candidate_task.id))))
  AND e.created_at=($5::jsonb->>'frozenAt')::timestamptz LIMIT 1
), identity_insert AS (
 INSERT INTO brain_events(event_type,details) VALUES('independent-reviewer-attested',$7::jsonb)
 ON CONFLICT DO NOTHING RETURNING id
), identity AS (
 SELECT id FROM identity_insert
 UNION ALL
 SELECT e.id FROM brain_events e
 WHERE e.event_type='independent-reviewer-attested' AND e.details->>'adapterKey'=$8
  AND e.details=$7::jsonb LIMIT 1
), baseline_observed_insert AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT id,'observed',jsonb_build_object('source','github-review-readback','adapterKey',$9::text)
 FROM baseline_task ON CONFLICT DO NOTHING RETURNING id
), baseline_observed AS (
 SELECT id FROM baseline_observed_insert
 UNION ALL
 SELECT e.id FROM brain_events e,baseline_task
 WHERE e.event_type='observed' AND e.details->>'adapterKey'=$9
  AND e.task_id=baseline_task.id
  AND e.details=jsonb_build_object('source','github-review-readback','adapterKey',$9::text)
 LIMIT 1
), candidate_observed_insert AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT id,'observed',jsonb_build_object('source','github-review-readback','adapterKey',$10::text)
 FROM candidate_task ON CONFLICT DO NOTHING RETURNING id
), candidate_observed AS (
 SELECT id FROM candidate_observed_insert
 UNION ALL
 SELECT e.id FROM brain_events e,candidate_task
 WHERE e.event_type='observed' AND e.details->>'adapterKey'=$10
  AND e.task_id=candidate_task.id
  AND e.details=jsonb_build_object('source','github-review-readback','adapterKey',$10::text)
 LIMIT 1
), assessment_insert AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT candidate_task.id,'independent-reviewer-assessment',$11::jsonb ||
  jsonb_build_object('reviewer',($11::jsonb->'reviewer') ||
   jsonb_build_object('identityReceiptId',identity.id))
 FROM candidate_task,identity ON CONFLICT DO NOTHING RETURNING id
), assessment AS (
 SELECT id FROM assessment_insert
 UNION ALL
 SELECT e.id FROM brain_events e,candidate_task,identity
 WHERE e.event_type='independent-reviewer-assessment' AND e.details->>'adapterKey'=$12
  AND e.task_id=candidate_task.id
  AND e.details=($11::jsonb || jsonb_build_object('reviewer',
   ($11::jsonb->'reviewer') ||
   jsonb_build_object('identityReceiptId',identity.id)))
 LIMIT 1
), evaluation_insert AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'review-proxy-observed',$13::jsonb || jsonb_build_object(
  'manifestReceiptId',manifest.id,
  'taskIds',jsonb_build_array(baseline_task.id,candidate_task.id),
  'outcomeReceiptIds',jsonb_build_array(baseline_observed.id,candidate_observed.id))
 FROM manifest,baseline_task,candidate_task,baseline_observed,candidate_observed
 ON CONFLICT DO NOTHING RETURNING id
), evaluation AS (
 SELECT id FROM evaluation_insert
 UNION ALL
 SELECT e.id FROM brain_events e,manifest,baseline_task,candidate_task,
  baseline_observed,candidate_observed
 WHERE e.event_type='review-proxy-observed' AND e.details->>'adapterKey'=$14
  AND e.details=($13::jsonb || jsonb_build_object(
   'manifestReceiptId',manifest.id,
   'taskIds',jsonb_build_array(baseline_task.id,candidate_task.id),
   'outcomeReceiptIds',jsonb_build_array(baseline_observed.id,candidate_observed.id)))
 LIMIT 1
), projection AS (
 SELECT identity.id AS identity_id,assessment.id AS assessment_id,
  manifest.id AS manifest_id,evaluation.id AS evaluation_id,
  baseline_task.id AS baseline_task_id,candidate_task.id AS candidate_task_id,
  baseline_observed.id AS baseline_receipt_id,candidate_observed.id AS candidate_receipt_id
 FROM identity,assessment,manifest,evaluation,baseline_task,candidate_task,
  baseline_observed,candidate_observed
)
SELECT
 (SELECT identity_id FROM projection) AS identity_id,
 (SELECT assessment_id FROM projection) AS assessment_id,
 (SELECT manifest_id FROM projection) AS manifest_id,
 (SELECT evaluation_id FROM projection) AS evaluation_id,
 (SELECT baseline_task_id FROM projection) AS baseline_task_id,
 (SELECT candidate_task_id FROM projection) AS candidate_task_id,
 (SELECT baseline_receipt_id FROM projection) AS baseline_receipt_id,
 (SELECT candidate_receipt_id FROM projection) AS candidate_receipt_id,
 -- A mismatched prior receipt must abort this entire statement, not commit partial CTE writes.
 1 / CASE WHEN (SELECT COUNT(*) FROM projection)=1 THEN 1 ELSE 0 END AS consistency_guard`;

/** Persist the independently reread GitHub evidence in one idempotent SQL statement. */
export async function persistAcceptanceEvidence({db,objectiveId,candidatePullNumber,
 fetchImpl=fetch}={}){
 const observed=await observeAcceptanceEvidence({objectiveId,candidatePullNumber,fetchImpl});
 const details=reviewEvidenceProjection(observed),short=observed.sourceSha.slice(0,12);
 const params=[
  'heldout:'+objectiveId+':'+short+':baseline',JSON.stringify(details.baselineResult),
  'heldout:'+objectiveId+':'+short+':candidate',JSON.stringify(details.candidateResult),
  JSON.stringify(details.manifest),details.manifest.adapterKey,
  JSON.stringify(details.identity),details.identity.adapterKey,
  details.key+':baseline-observed',details.key+':candidate-observed',
  JSON.stringify(details.assessment),details.assessment.adapterKey,
  JSON.stringify(details.evaluation),details.evaluation.adapterKey
 ];
 let saved;
 // A concurrent identical ON CONFLICT winner may be invisible to the first
 // statement snapshot. Recheck once in a new statement snapshot; do not retry
 // any external GitHub write or non-22012 database error.
 for(let attempt=0;attempt<2&&!saved;attempt++){
  try{saved=await db.query(PERSIST_SQL,params);}
  catch(error){
   // SQLSTATE 22012 comes only from the projection consistency guard.
   if(error?.code!=='22012')throw error;
   if(attempt===1)throw Error('acceptance-ledger-conflict');
  }
 }
 if(saved.rows.length!==1)throw Error('acceptance-ledger-conflict');
 return {ok:true,observed,receipts:saved.rows[0]};
}

// Compare complete JSONB projections without relying on PostgreSQL's object-key order.
function sameJson(left,right){
 if(left===right)return true;
 if(Array.isArray(left)||Array.isArray(right))
  return Array.isArray(left)&&Array.isArray(right)&&
   left.length===right.length&&left.every((item,i)=>sameJson(item,right[i]));
 if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
 const a=Object.keys(left).sort(),b=Object.keys(right).sort();
 return a.length===b.length&&a.every((key,i)=>key===b[i]&&sameJson(left[key],right[key]));
}

/** Re-read GitHub so persisted adapter labels cannot make themselves trusted. */
export async function verifyPersistedAcceptanceEvidence({
 objectiveId,sourceSha,identity,assessment,fetchImpl=fetch
}={}){
 const candidatePullNumber=integer(identity?.candidatePullNumber);
 if(!candidatePullNumber||candidatePullNumber!==assessment?.candidatePullNumber)
  return {reviewer:false,evaluation:false};
 try{
  const observed=await observeAcceptanceEvidence({objectiveId,candidatePullNumber,
   sourceSha,fetchImpl});
  const expectedAssessment=reviewEvidenceProjection(observed).assessment;
  const normalizedAssessment={...assessment,reviewer:{...assessment?.reviewer}};
  // Persistence adds this receipt link after assembling the expected assessment.
  delete normalizedAssessment.reviewer.identityReceiptId;
  const assessmentMatches=sameJson(normalizedAssessment,expectedAssessment);
  const reviewer=assessmentMatches&&identity.reviewerId===observed.reviewerId&&
   identity.reviewId===observed.reviewId&&assessment.reviewId===observed.reviewId&&
   assessment.reviewer?.id===observed.reviewerId;
  return {reviewer,evaluation:false};
 }catch(error){
  const code=/^github-status-\d{3}$/.test(String(error?.message||''))?
   error.message:'readback-error';
  console.warn('acceptance-reread-failed:'+code);
  return {reviewer:false,evaluation:false};
 }
}
