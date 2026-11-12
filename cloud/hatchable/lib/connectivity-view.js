import {evaluateWorkflowEvidence,CORE_VERIFY_WORKFLOW} from './ci-evidence.js';
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const REPO_URL='https://github.com/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;

function observedDate(value){
 if(value==null)return null;
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toISOString():null;
}
function safeText(value,max=150){return typeof value==='string'?value.slice(0,max):'';}
function safeGithubUrl(value,pathPrefix){
 if(typeof value!=='string'||!value.startsWith(REPO_URL+pathPrefix))return null;
 try{
  const parsed=new URL(value);
  return parsed.origin==='https://github.com'&&parsed.pathname.startsWith('/michaeljwilliams0123/Ultron.MW'+pathPrefix)
   ?parsed.href:null;
 }catch{return null;}
}
async function githubJson(fetchGithub,path){
 const response=await fetchGithub(API+path,{
  method:'GET',cache:'no-store',headers:{Accept:'application/vnd.github+json',
   'User-Agent':'UltronMW-Connectivity'},
  signal:AbortSignal.timeout(7000)
 });
 if(!response?.ok)throw Error('github-http-'+(Number(response?.status)||'unknown'));
 return response.json();
}
function failure(result,fallback='unavailable'){
 return result.status==='rejected'?{state:fallback,reason:safeText(result.reason?.message||'unavailable',60)}:null;
}
const read=(result)=>result.status==='fulfilled'?result.value:null;
export async function collectConnectivity({db,fetchGithub=fetch,now=()=>new Date().toISOString()}={}){
 const observedAt=now();
 const [control,counts,tasks,head,prs,runs]=await Promise.allSettled([
  db.query('SELECT paused,version,(SELECT MAX(created_at) FROM brain_events) AS last_event_at FROM brain_runtime_control WHERE id=1 LIMIT 1'),
  db.query('SELECT status,count(*)::integer AS total FROM brain_tasks GROUP BY status'),
  db.query('SELECT id,objective,status,attempts,updated_at FROM brain_tasks ORDER BY updated_at DESC,id DESC LIMIT 8'),
  githubJson(fetchGithub,'/git/ref/heads/main'),
  githubJson(fetchGithub,'/pulls?state=open&per_page=8&sort=updated&direction=desc'),
  githubJson(fetchGithub,'/actions/workflows/verify.yml/runs?branch=main&event=push&per_page=100')
 ]);
 const controlRow=read(control)?.rows?.[0];
 const runtime=controlRow&&typeof controlRow.paused==='boolean'?{
  state:controlRow.paused?'paused':'active',
  stopVersion:Number(controlRow.version)||null,
  lastEventAt:observedDate(controlRow.last_event_at)
 }:{state:'unavailable',reason:failure(control)?.reason||'runtime-control-missing',
  stopVersion:null,lastEventAt:null};
 const statusRows=read(counts)?.rows;
 const taskRows=read(tasks)?.rows;
 const queue={
  state:Array.isArray(statusRows)&&Array.isArray(taskRows)?'observed':'unavailable',
  counts:{},
  recent:[],
  reason:failure(counts)?.reason||failure(tasks)?.reason||null
 };
 if(queue.state==='observed'){
  for(const row of statusRows){
   if(typeof row.status==='string'&&/^[a-z-]{1,24}$/.test(row.status))
    queue.counts[row.status]=Math.max(0,Number(row.total)||0);
  }
  queue.recent=taskRows.map(row=>({
   id:Number(row.id)||0,objective:safeText(row.objective,60),
   status:safeText(row.status,24),attempts:Number(row.attempts)||0,
   updatedAt:observedDate(row.updated_at)
  })).filter(row=>row.id>0);
 }
 const mainSha=read(head)?.object?.sha;
 const github=SHA.test(mainSha||'')?
  {state:'observed',mainSha,repositoryUrl:REPO_URL}:
  {state:'unavailable',mainSha:null,repositoryUrl:REPO_URL,
    reason:failure(head)?.reason||'main-ref-not-verified'};
 let pullRequests={state:'unavailable',items:[],sampled:0,partial:false};
 const pullRows=read(prs);
 if(Array.isArray(pullRows)){
  const items=pullRows.slice(0,8).filter(v=>Number.isSafeInteger(v.number)&&v.number>0)
   .map(v=>({
    number:v.number,title:safeText(v.title)||'Untitled pull request',
    updatedAt:observedDate(v.updated_at),draft:v.draft===true,
    url:safeGithubUrl(v.html_url,'/pull/')||REPO_URL+'/pulls'
   }));
  pullRequests={state:'observed',items,sampled:items.length,partial:pullRows.length>=8};
 }else pullRequests.reason=failure(prs)?.reason||'invalid-pull-list';
 let ci={state:'unavailable',status:null,conclusion:null,runId:null,
  runUrl:REPO_URL+'/actions',sourceSha:null,observedAt:null};
 const workflowRows=read(runs)?.workflow_runs;
 if(github.state!=='observed')
  ci.reason='main-ref-not-verified';
 else if(!Array.isArray(workflowRows))
  ci.reason=failure(runs)?.reason||'invalid-ci-list';
 else{
  const candidates=workflowRows.filter(run=>run?.path===CORE_VERIFY_WORKFLOW.path&&
   run?.workflow_id===CORE_VERIFY_WORKFLOW.workflowId&&
   run?.head_sha===mainSha&&run?.head_branch==='main'&&
   run?.head_repository?.full_name==='michaeljwilliams0123/Ultron.MW'&&
   run?.event==='push').sort((a,b)=>b.id-a.id);
  const selected=candidates[0];
  let jobsByRunId={};
  if(selected){
   try{jobsByRunId[selected.id]=await githubJson(fetchGithub,
    '/actions/runs/'+selected.id+'/jobs?filter=all&per_page=100');}
   catch{jobsByRunId={};}
  }
  const evidence=evaluateWorkflowEvidence({runs:workflowRows,
   jobsByRunId,targetSha:mainSha,allowedEvents:['push']});
  ci={state:evidence.status==='pending-or-absent'?'no-current-main-run':
   evidence.status==='verified'?'observed':evidence.status,
   status:selected?safeText(selected.status,32)||'unknown':null,
   conclusion:evidence.verified?'success':null,
   runId:evidence.runId,
   runUrl:selected?safeGithubUrl(selected.html_url,'/actions/runs/')||REPO_URL+'/actions':REPO_URL+'/actions',
   sourceSha:mainSha,observedAt:observedDate(selected?.created_at)};
 }
 return {schema:'ultron.connectivity.v1',observedAt,paidCeilingCents:0,
  runtime,queue,github,ci,pullRequests};
}
