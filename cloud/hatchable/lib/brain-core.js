import {
 buildCouncilAssessmentReceipts,evaluateCouncilEvidence
} from 'lib/council-evidence.js';

const REPO = 'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const SITE = 'https://michaeljwilliams0123.github.io/Ultron.MW/';
const SHA = /^[0-9a-f]{40}$/;
const REQUIRED_WORKFLOW='Ultron core verification';
const REQUIRED_JOB='test';
const HEADERS = {Accept:'application/vnd.github+json','User-Agent':'UltronMW-Cloud-Brain'};
export const CAPABILITIES = [
 {id:'repo.inspect',kind:'github-native',effect:'read',description:'Verify the canonical GitHub main commit'},
 {id:'repo.prs',kind:'github-native',effect:'read',description:'Observe up to twelve open pull requests'},
 {id:'repo.ci',kind:'github-native',effect:'read',description:'Observe up to twelve recent Actions runs'},
 {id:'site.render',kind:'browser-native',effect:'read',description:'Render public GitHub Pages with managed Chromium'},
 {id:'council.review',kind:'brain-native',effect:'advisory',description:'Review recent verified receipts and propose next inspection'}
];
export const ALLOWED = new Set(CAPABILITIES.map(x=>x.id));
async function github(path){
 const response = await fetch(REPO+path,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('github-status-'+response.status);
 return response.json();
}
function safeString(v,max=150){return String(v??'').slice(0,max);}
async function currentMainSha(){
 const ref=await github('/git/ref/heads/main');
 if(!SHA.test(ref?.object?.sha||''))throw Error('invalid-main-ref');
 return ref.object.sha;
}
async function sourceBound(read){
 const before=await currentMainSha();
 const result=await read(before);
 const after=await currentMainSha();
 if(after!==before)throw Error('main-moved-during-observation');
 return {...result,source_sha:before};
}
export async function executeObjective(objective, {db,browser,task={}}){
 const at=new Date().toISOString();
 if(objective==='repo.inspect'){
  const sha=await currentMainSha();
  return {objective,at,source:'github-api',repository:'michaeljwilliams0123/Ultron.MW',sha};
 }
 if(objective==='repo.prs'){
  return sourceBound(async()=>{
   const rows=await github('/pulls?state=open&per_page=12&sort=updated&direction=desc');
   if(!Array.isArray(rows))throw Error('invalid-pr-response');
   return {objective,at,source:'github-api',count:rows.length,
    partial:rows.length===12,prs:rows.map(p=>({number:p.number,
     title:safeString(p.title),draft:!!p.draft,updated_at:p.updated_at,
     url:p.html_url,head:safeString(p.head?.sha,40)}))};
  });
 }
 if(objective==='repo.ci'){
  return sourceBound(async sourceSha=>{
   const data=await github('/actions/runs?head_sha='+encodeURIComponent(sourceSha)+'&per_page=12');
   if(!Array.isArray(data.workflow_runs)||!Number.isSafeInteger(data.total_count)||
      data.total_count<0)throw Error('invalid-runs-response');
   const runs=data.workflow_runs.map(r=>({id:r.id,name:safeString(r.name,90),
    status:r.status,conclusion:r.conclusion,head_sha:safeString(r.head_sha,40),
    url:r.html_url,event:r.event,created_at:r.created_at}));
   const selected=runs.filter(r=>r.head_sha===sourceSha&&r.name===REQUIRED_WORKFLOW&&
    r.event==='push').sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||
     b.id-a.id)[0];
   if(selected){
    const jobs=await github('/actions/runs/'+selected.id+'/jobs?per_page=100');
    if(!Array.isArray(jobs.jobs)||!Number.isSafeInteger(jobs.total_count)||
       jobs.total_count<0)throw Error('invalid-jobs-response');
    selected.jobs_complete=jobs.total_count===jobs.jobs.length&&jobs.total_count<100;
    const required=jobs.jobs.filter(job=>job?.name===REQUIRED_JOB);
    selected.required_job=required.length===1?{
     name:REQUIRED_JOB,status:required[0].status,conclusion:required[0].conclusion
    }:null;
   }
   return {objective,at,source:'github-api',count:runs.length,
    total_count:data.total_count,
    complete:data.total_count===runs.length&&data.total_count<=12,runs};
  });
 }
 if(objective==='site.render'){
  return sourceBound(async()=>{
   const html=await browser.html(SITE);
   if(typeof html!=='string' || !html.length)throw Error('empty-rendered-page');
   const title=(html.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1]||'';
   const marker=(html.match(/<meta[^>]+name=["']ultron-source-sha["'][^>]+content=["']([a-f0-9]{40})["']/i)||[])[1]||null;
   const rendered=html.toLowerCase();
   return {objective,at,source:'hatchable-chromium',url:SITE,
    title:safeString(title),html_bytes:html.length,
    has_app_shell:rendered.includes('<body'),has_ultron:rendered.includes('ultron'),
    runtime_source_sha:marker};
  });
 }
 if(objective==='council.review'){
  const objectiveId=typeof task.taskKey==='string'&&task.taskKey?
   task.taskKey:'council-review-unbound';
  const sourceSha=await currentMainSha();
  const recent=(await db.query(`SELECT t.id,t.task_key,t.objective,t.status,t.last_result,t.updated_at,
   (SELECT e.id FROM brain_events e WHERE e.task_id=t.id AND e.event_type='observed'
    ORDER BY e.id DESC LIMIT 1) AS receipt_id
   FROM brain_tasks t WHERE t.status='done' AND t.objective <> 'council.review'
   ORDER BY t.updated_at DESC LIMIT 16`)).rows;
  const evidenceParams=[objectiveId,sourceSha];
  const identityRows=(await db.query(`SELECT id,details,created_at FROM brain_events
   WHERE event_type='independent-reviewer-attested'
    AND details->>'objectiveId'=$1 AND details->>'sourceSha'=$2
   ORDER BY id DESC LIMIT 16`,evidenceParams)).rows.filter(row=>
    row.details?.objectiveId===objectiveId&&row.details?.sourceSha===sourceSha);
  const independentRows=(await db.query(`SELECT id,task_id,details,created_at FROM brain_events
   WHERE event_type='independent-reviewer-assessment'
    AND details->>'objectiveId'=$1 AND details->>'sourceSha'=$2
   ORDER BY id DESC LIMIT 16`,evidenceParams)).rows.filter(row=>
    row.details?.objectiveId===objectiveId&&row.details?.sourceSha===sourceSha);
  const evaluationRows=(await db.query(`SELECT id,details,created_at FROM brain_events
   WHERE event_type='held-out-evaluation-observed'
    AND details->>'objectiveId'=$1 AND details->>'sourceSha'=$2
   ORDER BY id DESC LIMIT 16`,evidenceParams)).rows.filter(row=>
    row.details?.objectiveId===objectiveId&&row.details?.sourceSha===sourceSha);
  const find=(type)=>recent.find(x=>x.objective===type)?.last_result;
  const latestCi=find('repo.ci'),latestPrs=find('repo.prs'),latestSite=find('site.render'),latestMain=find('repo.inspect');
  const failed=(latestCi?.runs||[]).filter(r=>r.conclusion==='failure');
  const advisory={
   verifier:{assessment:latestMain?'main-observed':'main-evidence-missing',next:latestMain?'repo.ci':'repo.inspect'},
   sentinel:{assessment:failed.length?'recent-failing-runs':'no-observed-failing-runs-or-evidence-incomplete',count:failed.length,next:'repo.ci'},
   planner:{assessment:latestPrs?'pr-inventory-observed':'pr-inventory-missing',count:latestPrs?.count??null,next:'repo.prs'},
   skeptic:{assessment:latestSite?.has_app_shell?'site-render-observed':'site-render-unverified',next:'site.render'}
  };
  const observations=recent.map(row=>({
   taskId:row.id,receiptId:row.receipt_id,objective:row.objective,
   result:row.last_result,observedAt:new Date(row.updated_at).toISOString()
  }));
  const assessmentReceipts=sourceSha?buildCouncilAssessmentReceipts({
   objectiveId,sourceSha,observations,assessedAt:at
  }):[];
  const identityAttestations=identityRows.map(row=>({
   eventId:row.id,eventType:'independent-reviewer-attested',
   objectiveId:row.details?.objectiveId,sourceSha:row.details?.sourceSha,
   reviewerId:row.details?.reviewerId,identitySource:row.details?.identitySource,
   observedAt:new Date(row.created_at).toISOString(),verified:row.details?.verified,
   verifiedBy:row.details?.verifiedBy
  }));
  const independentReceipts=independentRows.map(row=>({
   ...row.details,taskIds:[row.task_id],taskReceiptIds:[row.id],
   assessedAt:new Date(row.created_at).toISOString()
  }));
  let evaluation=null;
  if(evaluationRows.length===1){
   const row=evaluationRows[0];
   const manifestReceiptId=Number.isSafeInteger(row.details?.manifestReceiptId)&&
    row.details.manifestReceiptId>0?row.details.manifestReceiptId:null;
   const outcomeReceiptIds=Array.isArray(row.details?.outcomeReceiptIds)?
    row.details.outcomeReceiptIds.filter(id=>Number.isSafeInteger(id)&&id>0):[];
   const manifestRows=manifestReceiptId?(await db.query(
    `SELECT id,event_type,details,created_at FROM brain_events
     WHERE event_type='held-out-evaluation-frozen' AND id=$1`,
    [manifestReceiptId])).rows:[];
   const outcomeRows=outcomeReceiptIds.length?(await db.query(
    `SELECT e.id,e.task_id,e.event_type,e.created_at,
      t.objective AS task_objective,t.last_result
     FROM brain_events e JOIN brain_tasks t ON t.id=e.task_id
     WHERE e.event_type='observed' AND e.id = ANY($1::bigint[]) ORDER BY e.id`,
    [outcomeReceiptIds])).rows:[];
   const manifestRow=manifestRows.length===1?manifestRows[0]:null;
   evaluation={...row.details,eventId:row.id,
    eventType:'held-out-evaluation-observed',
    observedAt:new Date(row.created_at).toISOString(),
    manifestReadback:manifestRow?{...manifestRow.details,
     receiptId:manifestRow.id,eventType:manifestRow.event_type,
     observedAt:new Date(manifestRow.created_at).toISOString()}:null,
    outcomeReadbacks:outcomeRows.map(outcome=>({receiptId:outcome.id,
     taskId:outcome.task_id,eventType:outcome.event_type,
     observedAt:new Date(outcome.created_at).toISOString(),
     taskObjective:outcome.task_objective,result:outcome.last_result}))};
  }
  const promotionGate=evaluateCouncilEvidence({
   objectiveId,sourceSha,receipts:[...assessmentReceipts,...independentReceipts],now:at,
   lease:{state:'active',tokenMatches:true},provider:{required:false},
   identityAttestations,evaluation
  });
  if(await currentMainSha()!==sourceSha)throw Error('main-moved-during-council-evaluation');
  return {objective,at,source:'local-evidence-only',source_sha:sourceSha,
   evidence_count:recent.length,advisory,assessment_receipts:assessmentReceipts,
   promotion_gate:promotionGate,
   disposition:'proposals-only-no-write-or-model-inference'};
 }
 throw Error('objective-not-allowed');
}
