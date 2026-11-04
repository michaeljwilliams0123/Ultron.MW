/** GitHub workflow_run admission: no LLM output, no external writes, no paid work.
 * Caller MUST authenticate raw bytes with GitHub's HMAC-SHA256 before validation.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const DELIVERY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED=Object.freeze({
 'hf-heldout-cpu.yml':'heldout',
 'hf-free-cpu-tournament.yml':'tournament',
 'c06-owner-model-release.yml':'c06'
});
const PATH=/^\.github\/workflows\/([a-z0-9-]+\.yml)$/;
const STATUS=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure']);
function nope(){throw Error('untrusted-github-workflow');}
function shape(r){
 const file=typeof r?.path==='string'?r.path.match(PATH)?.[1]:null;
 if(!file||!Object.hasOwn(FIXED,file))nope();
 if(!Number.isSafeInteger(r.id)||r.id<=0||
    !Number.isSafeInteger(r.run_attempt)||r.run_attempt<1||
    r.event!=='workflow_dispatch'||r.status!=='completed'||
    !STATUS.has(r.conclusion)||!SHA.test(r.head_sha||'')||
    r.head_branch!=='main'||r.actor?.login!==OWNER||
    r.repository?.full_name!==REPO||r.repository?.private!==false)
  nope();
 return {workflowKey:FIXED[file],path:r.path,
  runId:r.id,runAttempt:r.run_attempt,sourceSha:r.head_sha,
  conclusion:r.conclusion};
}
export function validateGithubWorkflowPayload(data){
 if(!data||data.action!=='completed'||data.repository?.full_name!==REPO||
    data.repository?.private!==false)nope();
 return Object.freeze(shape(data.workflow_run));
}
export function compareGithubRun(event,run){
 try{
  const observed=shape(run);
  const verified=observed.workflowKey===event.workflowKey&&
   observed.runId===event.runId&&observed.runAttempt===event.runAttempt&&
   observed.sourceSha===event.sourceSha&&observed.conclusion===event.conclusion;
  return {verified,reason:verified?null:'readback-mismatch'};
 }catch{return {verified:false,reason:'readback-mismatch'};}
}
export function selectArtifactMetadata(key,runId,artifacts,sourceSha=null){
 if(!Array.isArray(artifacts))return [];
 const names={heldout:/^hf-heldout-(?:baseline|coder-small|coder-medium|coder-large)-s[01]-[a-f0-9]{40}$/,
  tournament:/^hf-cpu-(?:baseline|coder-small|coder-medium)-s[01]-[a-f0-9]{40}$/};
 return artifacts.filter(a=>{
  if(!Number.isSafeInteger(a?.id)||a.id<1||a.expired===true||
     !Number.isSafeInteger(a.size_in_bytes)||a.size_in_bytes<0||
     a.size_in_bytes>20_000_000)return false;
  if(key==='c06')return a.name==='c06-model-output-'+runId;
  if(!names[key]?.test(a.name||''))return false;
  return sourceSha==null||a.name.endsWith('-'+sourceSha);
 }).slice(0,16).map(a=>({
  id:a.id,name:a.name,sizeBytes:a.size_in_bytes,
  digest:DIGEST.test(a.digest||'')?a.digest:null
 }));
}
export async function admitGithubDelivery({db,deliveryId,event,payloadSha256}={}){
 if(!db?.query||!DELIVERY.test(deliveryId||'')||
    !SHA.test(event?.sourceSha||'')||!Number.isSafeInteger(event.runId)||
    !/^[a-f0-9]{64}$/.test(payloadSha256||''))nope();
 const params=[deliveryId.toLowerCase(),event.runId,event.runAttempt,event.workflowKey,
  event.sourceSha,event.conclusion,payloadSha256];
 const inserted=await db.query(
  `INSERT INTO hf_github_receipts
   (delivery_id,run_id,run_attempt,workflow_key,source_sha,conclusion,payload_sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT DO NOTHING RETURNING id,delivery_id,run_id,run_attempt,
    workflow_key,source_sha,conclusion,payload_sha256,state`,params);
 const receipt=inserted.rows?.[0];
 if(receipt)return {created:true,id:Number(receipt.id),runId:event.runId};
 const seen=await db.query(
  `SELECT id,delivery_id,run_id,run_attempt,workflow_key,source_sha,
    conclusion,payload_sha256,state FROM hf_github_receipts
    WHERE delivery_id=$1 OR (run_id=$2 AND run_attempt=$3) LIMIT 2`,
  [params[0],event.runId,event.runAttempt]);
 const rows=seen.rows||[];
 if(rows.length!==1)throw Error('delivery-id-conflict');
 const p=rows[0];
 if((p.delivery_id===params[0]&&p.payload_sha256!==payloadSha256)||
  Number(p.run_id)!==event.runId||Number(p.run_attempt)!==event.runAttempt||
  p.workflow_key!==event.workflowKey||p.source_sha!==event.sourceSha||
  p.conclusion!==event.conclusion)throw Error('delivery-id-conflict');
 return {created:false,id:Number(p.id),runId:event.runId};
}
/** Only independently confirmed metadata is permitted to supersede a cache.
 * Never mutate the frozen historical benchmark, release gates, or model licenses.
 */
export function mergeVerifiedWorkflow(snapshot,rows){
 if(!snapshot||snapshot.schema!=='ultron.hf-lab.v1'||!Array.isArray(rows))return snapshot;
 const result={...snapshot,workflows:Array.isArray(snapshot.workflows)?
  snapshot.workflows.map(x=>({...x})):[]};
 for(const r of rows){
  if(r.state!=='verified'||!SHA.test(r.source_sha||'')||
     !Number.isSafeInteger(Number(r.run_id))||Number(r.run_id)<=0)continue;
  const i=result.workflows.findIndex(w=>w.key===r.workflow_key);
  if(i<0)continue;
  const prior=result.workflows[i];
  const priorId=Number(prior.runId||0),verifiedId=Number(r.run_id);
  if(priorId>verifiedId)continue;
  // GitHub's cached API result may already contain the same run ID before
  // signed delivery finishes independent reconciliation. Enrich ONLY if the
  // cached exact source and outcome agree; never mask a conflicting readback.
  if(priorId===verifiedId&&
     (prior.headSha!==r.source_sha||prior.conclusion!==r.conclusion||
      prior.status!=='completed'))continue;
  result.workflows[i]={...prior,state:'observed',runId:Number(r.run_id),
   status:'completed',conclusion:r.conclusion,headSha:r.source_sha,
   startedAt:r.github_verified_at,
   runUrl:'https://github.com/'+REPO+'/actions/runs/'+r.run_id,
   observation:'signed-webhook+github-readback',
   artifactsObserved:Array.isArray(r.artifacts)?r.artifacts.length:0};
 }
 return result;
}
