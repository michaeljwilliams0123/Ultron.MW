import {HELDOUT_CASE_IDS,evaluateHeldOutSource,heldOutScore} from 'lib/heldout-cases.js';

const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const REVIEWER={login:'coderabbitai[bot]',id:136622811,type:'Bot'};
const SHA40=/^[a-f0-9]{40}$/;
const OBJECTIVE=/^[a-z0-9][a-z0-9-]{5,79}$/;
const MANIFEST_SCHEMA='ultron.seeded-held-out-manifest.v1';
const SET_SCHEMA='ultron.held-out-evaluation-set.v1';
const OUTCOME_SCHEMA='ultron.held-out-outcome.v1';
const MARKER=/<!-- ultron-seeded-held-out-manifest:v1\s*\n([\s\S]*?)\n-->/;
const WORKFLOW='Ultron held-out acceptance';
const JOB='held-out';
const STEP='Evaluate post-freeze seeded cases';
const GENERATOR_PATH='cloud/hatchable/lib/heldout-cases.js';
const WORKFLOW_PATH='.github/workflows/held-out-acceptance.yml';
const ADAPTER_PATH='cloud/hatchable/lib/acceptance-evidence.js';
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'UltronMW-HeldOut-Adapter'};
const LIST_PAGE_LIMIT=10;

function integer(value){return Number.isSafeInteger(value)&&value>0?value:null;}
function iso(value){
 if(typeof value!=='string')return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
async function request(path,fetchImpl,{optional=false}={}){
 const response=await fetchImpl(REPO+path,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
 if(optional&&response.status===404)return null;
 if(!response.ok)throw Error('github-status-'+response.status);
 return response.json();
}
function nextPage(response,error){
 const link=response.headers?.get?.('link');
 if(!link)return null;
 const entry=link.split(',').find(value=>/;\s*rel="next"\s*$/.test(value.trim()));
 if(!entry)return null;
 const matched=entry.match(/^\s*<([^>]+)>/);
 if(!matched)throw Error(error);
 let next;
 try{next=new URL(matched[1]);}catch{throw Error(error);}
 const repository=new URL(REPO);
 if(next.origin!==repository.origin||!next.pathname.startsWith(repository.pathname+'/'))
  throw Error(error);
 return next.href;
}
async function list(path,fetchImpl,error){
 const items=[];
 let url=REPO+path;
 for(let page=0;page<LIST_PAGE_LIMIT;page++){
  const response=await fetchImpl(url,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('github-status-'+response.status);
  const values=await response.json();
  if(!Array.isArray(values))throw Error(error);
  items.push(...values);
  const next=nextPage(response,error);
  if(!next)return items;
  url=next;
 }
 throw Error(error);
}
function decode(file){
 if(!file||file.encoding!=='base64'||typeof file.content!=='string')return '';
 const bytes=Uint8Array.from(atob(file.content.replace(/\s/g,'')),char=>char.charCodeAt(0));
 return new TextDecoder().decode(bytes);
}
function manifestFrom(comments,{objectiveId,pullNumber,headSha,baseSha}){
 if(!Array.isArray(comments))throw Error('invalid-heldout-comments');
 const matches=[];
 for(const comment of comments){
  const marker=typeof comment?.body==='string'?comment.body.match(MARKER):null;
  if(!marker)continue;
  let value;
  try{value=JSON.parse(marker[1]);}catch{continue;}
  if(value?.schema!==MANIFEST_SCHEMA||value.objectiveId!==objectiveId||
     value.candidatePullNumber!==pullNumber||value.candidateHeadSha!==headSha||
     value.baselineSha!==baseSha||!SHA40.test(value.generatorBlobSha||'')||
     !SHA40.test(value.workflowBlobSha||'')||value.frozen!==true||
     value.setsDisjoint!==true||value.evaluator!=='github-actions-seeded-property-v1'||
     value.seedSource!=='github.run_id'||
     JSON.stringify(value.caseIds)!==JSON.stringify(HELDOUT_CASE_IDS)||
     comment.user?.login!==OWNER||comment.author_association!=='OWNER'||
     !integer(comment.id)||!iso(comment.created_at)||
     iso(comment.updated_at)!==iso(comment.created_at))continue;
  matches.push({comment,value});
 }
 if(matches.length!==1)throw Error(matches.length?'ambiguous-heldout-manifest':
  'seeded-heldout-manifest-missing');
 return matches[0];
}
function independentReviews(reviews,{headSha,after}){
 if(!Array.isArray(reviews))throw Error('invalid-heldout-reviews');
 return reviews.filter(review=>{
  const submitted=iso(review?.submitted_at),body=typeof review?.body==='string'?
   review.body:'';
  return integer(review?.id)&&review.user?.login===REVIEWER.login&&
   review.user?.id===REVIEWER.id&&review.user?.type===REVIEWER.type&&
   ['COMMENTED','APPROVED','CHANGES_REQUESTED'].includes(review.state)&&
   review.commit_id===headSha&&body.includes('<!-- coderabbit-ai-generated:v1 -->')&&
   submitted&&Date.parse(submitted)>Date.parse(after);
 });
}

/** Reproduce the externally seeded exact cases from immutable GitHub source. */
export async function observeHeldOutEvidence({
 objectiveId,candidatePullNumber,sourceSha=null,fetchImpl=fetch
}={}){
 if(!OBJECTIVE.test(objectiveId||'')||typeof candidatePullNumber!=='number'||
    !integer(candidatePullNumber)||(sourceSha!==null&&!SHA40.test(sourceSha)))
  throw Error('invalid-heldout-request');
 const [ref,candidate,comments,reviews]=await Promise.all([
  request('/git/ref/heads/main',fetchImpl),request('/pulls/'+candidatePullNumber,fetchImpl),
  list('/issues/'+candidatePullNumber+'/comments?per_page=100',fetchImpl,
   'invalid-heldout-comments'),
  list('/pulls/'+candidatePullNumber+'/reviews?per_page=100',fetchImpl,
   'invalid-heldout-reviews')
 ]);
 const currentSha=ref?.object?.sha;
 if(!SHA40.test(currentSha||'')||(sourceSha&&sourceSha!==currentSha))
  throw Error('heldout-source-sha-mismatch');
 if(candidate?.number!==candidatePullNumber||!SHA40.test(candidate?.head?.sha||'')||
    !SHA40.test(candidate?.base?.sha||'')||candidate.user?.login!==OWNER||
    candidate.merged!==true||candidate.merge_commit_sha!==currentSha)
  throw Error('heldout-candidate-not-current-merged-pr');
 const {comment,value:manifest}=manifestFrom(comments,{objectiveId,
  pullNumber:candidatePullNumber,headSha:candidate.head.sha,baseSha:candidate.base.sha});
 const reviewed=independentReviews(reviews,{headSha:candidate.head.sha,
  after:comment.created_at});
 if(reviewed.length!==1)throw Error(reviewed.length?'ambiguous-heldout-review':
  'heldout-review-missing');
 const review=reviewed[0];
 const [currentCommit,headCommit,generatorFile,workflowFile,baselineFile,candidateFile,runs]=
  await Promise.all([
   request('/commits/'+currentSha,fetchImpl),request('/commits/'+candidate.head.sha,fetchImpl),
   request('/contents/'+GENERATOR_PATH+'?ref='+candidate.head.sha,fetchImpl),
   request('/contents/'+WORKFLOW_PATH+'?ref='+candidate.head.sha,fetchImpl),
   request('/contents/'+ADAPTER_PATH+'?ref='+candidate.base.sha,fetchImpl,{optional:true}),
   request('/contents/'+ADAPTER_PATH+'?ref='+candidate.head.sha,fetchImpl),
   request('/actions/runs?head_sha='+currentSha+'&event=workflow_dispatch&per_page=100',fetchImpl)
  ]);
 if(!SHA40.test(currentCommit?.commit?.tree?.sha||'')||
    currentCommit.commit.tree.sha!==headCommit?.commit?.tree?.sha)
  throw Error('heldout-reviewed-tree-not-current-main');
 if(generatorFile?.sha!==manifest.generatorBlobSha||workflowFile?.sha!==manifest.workflowBlobSha)
  throw Error('heldout-frozen-source-mismatch');
 if(!Array.isArray(runs?.workflow_runs)||!Number.isSafeInteger(runs.total_count)||
    runs.total_count<0||runs.total_count!==runs.workflow_runs.length||runs.total_count>=100)
  throw Error('heldout-runs-incomplete');
 const title=WORKFLOW+' '+manifest.baselineSha+'..'+manifest.candidateHeadSha;
 const eligible=runs.workflow_runs.filter(run=>integer(run?.id)&&run.name===WORKFLOW&&
  run.display_title===title&&run.event==='workflow_dispatch'&&run.head_sha===currentSha&&
  run.status==='completed'&&run.conclusion==='success'&&iso(run.created_at)&&
  Date.parse(run.created_at)>Date.parse(comment.created_at));
 if(eligible.length!==1)throw Error(eligible.length?'ambiguous-heldout-run':'heldout-run-missing');
 const run=eligible[0];
 const jobs=await request('/actions/runs/'+run.id+'/jobs?per_page=100',fetchImpl);
 if(!Array.isArray(jobs?.jobs)||!Number.isSafeInteger(jobs.total_count)||
    jobs.total_count!==jobs.jobs.length||jobs.total_count>=100)throw Error('heldout-jobs-incomplete');
 const selected=jobs.jobs.filter(job=>job?.name===JOB&&job.status==='completed'&&
  job.conclusion==='success');
 if(selected.length!==1||!selected[0].steps?.some(step=>step.name===STEP&&
    step.status==='completed'&&step.conclusion==='success'))throw Error('heldout-job-invalid');
 const [baselineCases,candidateCases]=await Promise.all([
  evaluateHeldOutSource({source:decode(baselineFile),seed:String(run.id),variant:'baseline'}),
  evaluateHeldOutSource({source:decode(candidateFile),seed:String(run.id),variant:'candidate'})
 ]);
 const baselineScore=heldOutScore(baselineCases),candidateScore=heldOutScore(candidateCases);
 if(candidateCases.some(item=>!item.passed)||candidateScore<=baselineScore)
  throw Error('heldout-reproduction-mismatch');
 return Object.freeze({objectiveId,sourceSha:currentSha,candidatePullNumber,
  candidateHeadSha:candidate.head.sha,baselineSha:candidate.base.sha,
  freezeCommentId:comment.id,frozenAt:iso(comment.created_at),evaluationRunId:run.id,
  independentReviewId:review.id,reviewedAt:iso(review.submitted_at),
  evaluatorId:'github-actions:'+run.id,
  setId:'seeded-heldout-'+candidate.base.sha.slice(0,12)+'-'+candidatePullNumber,
  baselineCases,candidateCases,baselineScore,candidateScore});
}

function projection(observed){
 const key='heldout:'+observed.objectiveId+':'+observed.sourceSha;
 const outcomes=[];
 for(let index=0;index<HELDOUT_CASE_IDS.length;index++){
  const caseId=HELDOUT_CASE_IDS[index];
  for(const variant of ['baseline','candidate']){
   const result=(variant==='baseline'?observed.baselineCases:observed.candidateCases)[index];
   outcomes.push({schema:OUTCOME_SCHEMA,objectiveId:observed.objectiveId,
    sourceSha:observed.sourceSha,setId:observed.setId,caseId,variant,
    evaluatedRevision:variant==='baseline'?observed.baselineSha:observed.candidateHeadSha,
    score:result.passed?1:0,status:result.passed?'passed':'failed',
    criticalRegression:variant==='candidate'&&!result.passed&&
     observed.baselineCases[index].passed,evaluationRunId:observed.evaluationRunId});
  }
 }
 const candidateFailures=observed.candidateCases.filter(item=>!item.passed).length;
 const criticalRegressions=outcomes.filter(item=>item.variant==='candidate'&&
  item.criticalRegression).length;
 return {key,outcomes,manifest:{schema:SET_SCHEMA,objectiveId:observed.objectiveId,
  sourceSha:observed.sourceSha,setId:observed.setId,frozen:true,setsDisjoint:true,
  freezeCommentId:observed.freezeCommentId,frozenAt:observed.frozenAt,
  baselineSha:observed.baselineSha,candidateHeadSha:observed.candidateHeadSha,
  independentReviewId:observed.independentReviewId,reviewedAt:observed.reviewedAt,
  evaluationRunId:observed.evaluationRunId,seedSource:'github.run_id',
  adapterKey:key+':manifest'},evaluation:{objectiveId:observed.objectiveId,
  sourceSha:observed.sourceSha,runtimeSourceSha:observed.sourceSha,
  frozen:true,setsDisjoint:true,independentlyObserved:true,outcomeReadbacksObserved:true,
  evaluator:{kind:'independent-evaluator',id:observed.evaluatorId},
  verifiedBy:{kind:'held-out-evaluation-readback',id:'held-out-evaluation-adapter'},
  baselineScore:observed.baselineScore,candidateScore:observed.candidateScore,
  setId:observed.setId,
  candidateFailures,criticalRegressions,candidatePullNumber:observed.candidatePullNumber,
  freezeCommentId:observed.freezeCommentId,evaluationRunId:observed.evaluationRunId,
  adapterKey:key+':evaluation'}};
}

const SQL=`WITH tasks AS (
 INSERT INTO brain_tasks(task_key,objective,status,attempts,max_attempts,last_result)
 SELECT $1 || ':' || (item->>'caseId') || ':' || (item->>'variant'),
  'held-out.evaluate','done',1,1,item
 FROM jsonb_array_elements($2::jsonb) AS item
 ON CONFLICT(task_key) DO UPDATE SET task_key=EXCLUDED.task_key
 WHERE brain_tasks.objective=EXCLUDED.objective AND brain_tasks.last_result=EXCLUDED.last_result
 RETURNING id,last_result
), pairs AS (
 SELECT last_result->>'caseId' AS case_id,
  max(id) FILTER (WHERE last_result->>'variant'='baseline') AS baseline_id,
  max(id) FILTER (WHERE last_result->>'variant'='candidate') AS candidate_id
 FROM tasks GROUP BY last_result->>'caseId'
), manifest_details AS (
 SELECT $3::jsonb || jsonb_build_object('cases',
  (SELECT jsonb_agg(jsonb_build_object('caseId',case_id,
   'baselineTaskId',baseline_id,'candidateTaskId',candidate_id) ORDER BY case_id) FROM pairs)) AS value
), manifest_insert AS (
 INSERT INTO brain_events(event_type,details,created_at)
 SELECT 'held-out-evaluation-frozen',value,($3::jsonb->>'frozenAt')::timestamptz
 FROM manifest_details WHERE (SELECT count(*) FROM tasks)=$4
 ON CONFLICT DO NOTHING RETURNING id
), manifest AS (
 SELECT id FROM manifest_insert UNION ALL
 SELECT e.id FROM brain_events e,manifest_details d
 WHERE e.event_type='held-out-evaluation-frozen' AND e.details->>'adapterKey'=$5
  AND e.details=d.value AND e.created_at=($3::jsonb->>'frozenAt')::timestamptz LIMIT 1
), observed_insert AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT id,'observed',jsonb_build_object('source','github-actions-seeded-readback',
  'adapterKey',$1 || ':observed:' || (last_result->>'caseId') || ':' ||
   (last_result->>'variant'))
 FROM tasks ON CONFLICT DO NOTHING RETURNING id,task_id,details
), observed AS (
 SELECT id,task_id FROM observed_insert UNION ALL
 SELECT e.id,e.task_id FROM brain_events e JOIN tasks t ON t.id=e.task_id
 WHERE e.event_type='observed' AND e.details=jsonb_build_object(
  'source','github-actions-seeded-readback','adapterKey',
  $1 || ':observed:' || (t.last_result->>'caseId') || ':' ||
   (t.last_result->>'variant'))
  AND NOT EXISTS (SELECT 1 FROM observed_insert i WHERE i.task_id=e.task_id)
), evaluation_details AS (
 SELECT $6::jsonb || jsonb_build_object('manifestReceiptId',manifest.id,
  'taskIds',(SELECT jsonb_agg(id ORDER BY id) FROM tasks),
  'outcomeReceiptIds',(SELECT jsonb_agg(id ORDER BY task_id) FROM observed)) AS value
 FROM manifest
), evaluation_insert AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'held-out-evaluation-observed',value FROM evaluation_details
 WHERE (SELECT count(*) FROM observed)=$4 ON CONFLICT DO NOTHING RETURNING id
), evaluation AS (
 SELECT id FROM evaluation_insert UNION ALL
 SELECT e.id FROM brain_events e,evaluation_details d
 WHERE e.event_type='held-out-evaluation-observed' AND e.details->>'adapterKey'=$7
  AND e.details=d.value LIMIT 1
), projection AS (
 SELECT manifest.id AS manifest_id,evaluation.id AS evaluation_id,
  (SELECT jsonb_agg(id ORDER BY id) FROM tasks) AS task_ids,
  (SELECT jsonb_agg(id ORDER BY task_id) FROM observed) AS outcome_receipt_ids
 FROM manifest,evaluation
)
SELECT (SELECT manifest_id FROM projection) AS manifest_id,
 (SELECT evaluation_id FROM projection) AS evaluation_id,
 (SELECT task_ids FROM projection) AS task_ids,
 (SELECT outcome_receipt_ids FROM projection) AS outcome_receipt_ids,
 1 / CASE WHEN (SELECT count(*) FROM tasks)=$4 AND
  (SELECT count(*) FROM observed)=$4 AND (SELECT count(*) FROM projection)=1
 THEN 1 ELSE 0 END AS consistency_guard`;

export async function persistHeldOutEvidence({db,objectiveId,candidatePullNumber,
 fetchImpl=fetch}={}){
 const observed=await observeHeldOutEvidence({objectiveId,candidatePullNumber,fetchImpl});
 const details=projection(observed),prefix='heldout:'+objectiveId+':'+
  observed.sourceSha.slice(0,12);
 const params=[prefix,JSON.stringify(details.outcomes),JSON.stringify(details.manifest),
  details.outcomes.length,details.manifest.adapterKey,JSON.stringify(details.evaluation),
  details.evaluation.adapterKey];
 let saved;
 for(let attempt=0;attempt<2&&!saved;attempt++){
  try{saved=await db.query(SQL,params);}
  catch(error){
   if(error?.code!=='22012')throw error;
   if(attempt===1)throw Error('heldout-ledger-conflict');
  }
 }
 if(saved.rows.length!==1)throw Error('heldout-ledger-conflict');
 return {ok:true,observed,receipts:saved.rows[0]};
}

export async function verifyPersistedHeldOutEvidence({
 objectiveId,sourceSha,evaluation,fetchImpl=fetch
}={}){
 const pull=integer(evaluation?.candidatePullNumber);
 if(!pull)return {evaluation:false};
 try{
  const observed=await observeHeldOutEvidence({objectiveId,candidatePullNumber:pull,
   sourceSha,fetchImpl});
  const expected=projection(observed).evaluation;
  const same=sameJson(evaluation,{...expected,
   manifestReceiptId:evaluation.manifestReceiptId,taskIds:evaluation.taskIds,
   outcomeReceiptIds:evaluation.outcomeReceiptIds});
  return {evaluation:same};
 }catch(error){
  const code=/^github-status-\d{3}$/.test(String(error?.message||''))?
   error.message:'readback-error';
  console.warn('heldout-reread-failed:'+code);
  return {evaluation:false};
 }
}

function sameJson(left,right){
 if(left===right)return true;
 if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&
  Array.isArray(right)&&left.length===right.length&&
  left.every((item,index)=>sameJson(item,right[index]));
 if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
 const a=Object.keys(left).sort(),b=Object.keys(right).sort();
 return a.length===b.length&&a.every((key,index)=>key===b[index]&&
  sameJson(left[key],right[key]));
}
