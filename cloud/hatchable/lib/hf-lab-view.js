import {mergeVerifiedWorkflow} from './hf-github-receipts.js';
import {LAB_LANE_FILE,labLaneRunKey} from './workflow-lanes.js';
/** Read-only Hugging Face evaluation lane, backed by GitHub Actions and durable cache.
 * Zero new paid inference calls. Never interpret a workflow green as model promotion.
 */
const GH='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const BROWSER='https://github.com/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const FRESH_MS=20*60*1000;
export const WORKFLOWS=Object.freeze([
 Object.freeze({key:'heldout',label:'16-case held-out CPU evaluation',
  file:'hf-heldout-cpu.yml'}),
 Object.freeze({key:'tournament',label:'Small CPU model tournament',
  file:'hf-free-cpu-tournament.yml'}),
 Object.freeze({key:'c06',label:'Model-authored 3-file PR candidate',
  file:'c06-owner-model-release.yml'})
]);
const frozenEvidence=Object.freeze({
 observation:'historical-evidence',
 runId:41764422463,
 runUrl:BROWSER+'/actions/runs/41764422463',
 sourceSha:'8530f25885dab764d4eb03fcf1bc76fb07c4487c',
 corpusSha:'f544c3fc6366959d6def15bc1cb191ff583ee9bc73c284c10cbd1e4bb2817fdd',
 cases:16,
 models:[
  {key:'baseline',label:'Qwen2.5 0.5B',passed:1,productionEligible:false},
  {key:'coder-small',label:'Qwen Coder 0.5B',passed:1,productionEligible:false},
  {key:'coder-medium',label:'Qwen Coder 1.5B',passed:2,productionEligible:false},
  {key:'coder-large',label:'Qwen Coder 3B',passed:7,productionEligible:false,
   license:'qwen-research',approvedUse:'noncommercial-evaluation-only'}
 ]
});
const release=Object.freeze({
 productionAccepted:false,autoPromotion:false,
 issueUrl:BROWSER+'/issues/245',
 admission:'owner-scoped-protected-PR-required',gpu:'unverified-free-quota',
 paidProviderUse:'disabled',modelRole:'evaluation-only'
});
const date=value=>{
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toISOString():null;
};
function emptyWorkflow(item,state='unavailable',reason=null){
 return {key:item.key,label:item.label,workflowUrl:BROWSER+'/actions/workflows/'+item.file,
  state,reason,runId:null,status:null,conclusion:null,headSha:null,
  runUrl:null,startedAt:null};
}
function emptySnapshot(observedAt){
 return {schema:'ultron.hf-lab.v1',observedAt,paidBudgetCents:0,
  workflows:WORKFLOWS.map(x=>emptyWorkflow(x)),
  benchmark:frozenEvidence,release};
}
async function listRuns(fetchGithub,file,perPage){
 const url=GH+'/actions/workflows/'+file+'/runs?per_page='+perPage+'&event=workflow_dispatch';
 const response=await fetchGithub(url,{method:'GET',cache:'no-store',
  headers:{Accept:'application/vnd.github+json','User-Agent':'Ultron-HF-Lab'},
  signal:AbortSignal.timeout(6500)});
 if(!response?.ok)throw Error('github-http-'+String(response?.status||'unknown'));
 const body=await response.json();
 if(!Array.isArray(body?.workflow_runs))throw Error('invalid-actions-response');
 return body.workflow_runs;
}
function observedRun(item,run,file){
 if(!run)return emptyWorkflow(item,'no-run',null);
 const valid=Number.isSafeInteger(run.id)&&run.id>0&&SHA.test(run.head_sha||'')&&
  ['queued','in_progress','completed','requested','waiting','pending'].includes(run.status);
 if(!valid)throw Error('invalid-workflow-receipt');
 const conclusion=run.status==='completed'&&typeof run.conclusion==='string'?
  run.conclusion.slice(0,32):null;
 return {key:item.key,label:item.label,
  workflowUrl:BROWSER+'/actions/workflows/'+file,
  state:'observed',reason:null,runId:run.id,status:run.status,
  conclusion,headSha:run.head_sha,
  runUrl:BROWSER+'/actions/runs/'+run.id,
  startedAt:date(run.created_at)};
}
async function inspectWorkflow(fetchGithub,item){
 const runs=await listRuns(fetchGithub,item.file,1);
 return observedRun(item,runs[0],item.file);
}
// Transition: the newest run wins across the legacy file and the consolidated
// lab lane. A lane run counts only with its exact path, name and run title.
// A lane run is shown only when it is an owner workflow_dispatch on main
// (Skeptic L1): a branch or bot run must never pose as the newest lab result.
const OWNER={login:'michaeljwilliams0123',id:308995719};
export function eligibleLaneRun(run,key){
 return labLaneRunKey(run)===key&&run.head_branch==='main'&&
  run.event==='workflow_dispatch'&&run.actor?.login===OWNER.login&&
  run.actor?.id===OWNER.id;
}
function newest(item,legacy,lane){
 const laneRun=lane.status==='fulfilled'?
  lane.value.find(run=>eligibleLaneRun(run,item.key)):undefined;
 if(legacy.status!=='fulfilled'){
  if(laneRun)return observedRun(item,laneRun,LAB_LANE_FILE);
  throw legacy.reason;
 }
 const legacyRun=legacy.value;
 if(laneRun&&(!legacyRun?.runId||laneRun.id>legacyRun.runId))
  return observedRun(item,laneRun,LAB_LANE_FILE);
 return legacyRun;
}
export async function collectHfRuns({fetchGithub=fetch,now=()=>new Date().toISOString()}={}){
 const observedAt=now();
 const [lane,...settled]=await Promise.allSettled([
  listRuns(fetchGithub,LAB_LANE_FILE,30),
  ...WORKFLOWS.map(item=>inspectWorkflow(fetchGithub,item))]);
 const result=emptySnapshot(observedAt);
 result.workflows=settled.map((v,i)=>{
  try{return newest(WORKFLOWS[i],v,lane);}
  catch(error){return emptyWorkflow(WORKFLOWS[i],'unavailable',
   String(error?.message||'provider-unavailable').slice(0,65));}
 });
 return result;
}
function present(snapshot,state,at,reason=null,verified=[]){
 const payload=snapshot?.schema==='ultron.hf-lab.v1'?snapshot:emptySnapshot(at);
 const reconciled=mergeVerifiedWorkflow(payload,verified);
 return {...reconciled,cache:{state,readAt:at,
  observedAt:payload.observedAt,reason,verifiedWebhookReceipts:verified.length}};
}
export async function getHfLabView({db,fetchGithub=fetch,
 now=()=>new Date().toISOString()}={}){
 const at=now(),instant=Date.parse(at);
 let previous;
 try{
  const r=await db.query('SELECT snapshot,observed_at,lease_until FROM hf_lab_cache WHERE id=$1',['owner']);
  previous=r.rows[0]||null;
 }catch{
  // No unsecured direct-fetch fallback: protects the public GitHub API quota.
  return present(null,'unavailable',at,'cache-storage-unavailable');
 }
 const prior=previous?.snapshot;
 let verified=[];
 try{
  const receipts=await db.query(`SELECT workflow_key,run_id,run_attempt,
    source_sha,conclusion,state,github_verified_at,
    artifact_evidence AS artifacts FROM hf_github_receipts
    WHERE state='verified' ORDER BY run_id DESC LIMIT 12`);
  verified=Array.isArray(receipts.rows)?receipts.rows:[];
 }catch{verified=[];}
 const age=instant-Date.parse(previous?.observed_at||'1970-01-01T00:00:00Z');
 if(prior?.schema==='ultron.hf-lab.v1'&&age>=0&&age<FRESH_MS)
  return present(prior,'fresh',at,null,verified);
 const key=crypto.randomUUID();
 let owned=false;
 try{
  const claimed=await db.query(
   `INSERT INTO hf_lab_cache(id,snapshot,observed_at,lease_until,refresh_key)
    VALUES('owner','{}'::jsonb,to_timestamp(0),now()+interval '45 seconds',$1)
    ON CONFLICT(id) DO UPDATE SET
      lease_until=now()+interval '45 seconds',refresh_key=EXCLUDED.refresh_key
    WHERE hf_lab_cache.lease_until < now() RETURNING id`,[key]);
  owned=claimed.rows.length===1;
 }catch{
  return present(prior,'stale',at,'cache-claim-unavailable',verified);
 }
 if(!owned)return present(prior,'stale',at,'refresh-already-running',verified);
 const snapshot=await collectHfRuns({fetchGithub,now});
 const observations=snapshot.workflows.filter(x=>x.state!=='unavailable').length;
 if(!observations){
  try{await db.query(
   `UPDATE hf_lab_cache SET lease_until=now()+interval '5 minutes',
    refresh_key=NULL WHERE id='owner' AND refresh_key=$1`,[key]);}catch{}
  return present(prior,'stale',at,'github-observation-unavailable',verified);
 }
 try{
  const stored=await db.query(
   `UPDATE hf_lab_cache SET snapshot=$2::jsonb,observed_at=$3::timestamptz,
    lease_until=to_timestamp(0),refresh_key=NULL
    WHERE id='owner' AND refresh_key=$1 RETURNING id`,
   [key,JSON.stringify(snapshot),at]);
  if(stored.rows.length!==1)return present(prior,'stale',at,'refresh-fence-lost',verified);
  return present(snapshot,'refreshed',at,null,verified);
 }catch{
  return present(prior,'stale',at,'cache-write-unconfirmed',verified);
 }
}
