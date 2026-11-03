/**
 * C06 live bounded deep-task completion: owner admission -> durable intent ->
 * one authorized Mahoraga issue write -> independent adapter readback ->
 * persisted outcome. Only GitHub issue.create in the fixed private sister repo.
 * Every unknown outcome remains reconcile-only; never blindly retry a write.
 */
const OWNER='michaeljwilliams0123';
const KEY=/^[a-z][a-z0-9_.:-]{7,119}$/;
const SHA=/^[a-f0-9]{40}$/;
const URL=/^https:\/\/github\.com\/michaeljwilliams0123\/mahoraga\/issues\/([1-9][0-9]*)$/;
function stop(reason){return Object.freeze({status:'held',reason,productionAccepted:false});}
function requestCopy(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 let fields;try{fields=Object.getOwnPropertyDescriptors(raw);}catch{return null;}
 if(Object.keys(fields).sort().join(',')!=='body,expectedMainSha,key,title')return null;
 const result=Object.create(null);
 for(const [key,d] of Object.entries(fields)){
  if(!d.enumerable||!Object.hasOwn(d,'value'))return null;
  result[key]=d.value;
 }
 if(typeof result.key!=='string'||!KEY.test(result.key)||
    typeof result.title!=='string'||!result.title.trim()||
    result.title.length>160||result.title.includes('\n')||
    typeof result.body!=='string'||!result.body.trim()||
    result.body.length>12000||
    result.body.includes('ULTRON_MAHORAGA_CONTROL_V1')||
    typeof result.expectedMainSha!=='string'||!SHA.test(result.expectedMainSha))
  return null;
 return Object.freeze(result);
}
async function fingerprint(request){
 const bytes=new TextEncoder().encode(JSON.stringify([
  'ultron.deep.issue.v1',request.key,request.title,
  request.body,request.expectedMainSha
 ]));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const AUTH_SQL=`SELECT a.owner,a.preset,a.version,
 a.max_paid_cents AS "maxPaidCents",c.paused,c.version AS "stopVersion"
 FROM brain_owner_autonomy_profile a
 JOIN brain_runtime_control c ON c.id=1 WHERE a.id=1`;
const ADMIT_SQL=`INSERT INTO brain_deep_objectives
 (task_key,fingerprint,profile_version,stop_version)
 VALUES($1,$2,$3,$4) ON CONFLICT(task_key) DO NOTHING RETURNING task_key`;
const READ_SQL=`SELECT task_key AS key,fingerprint,
 profile_version AS "profileVersion",stop_version AS "stopVersion",
 state,issue_number AS "issueNumber",external_url AS url
 FROM brain_deep_objectives WHERE task_key=$1`;
const CLAIM_SQL=`WITH control AS MATERIALIZED (
 SELECT paused,version FROM brain_runtime_control WHERE id=1 FOR SHARE
), profile AS MATERIALIZED (
 SELECT owner,preset,version,max_paid_cents
 FROM brain_owner_autonomy_profile WHERE id=1 FOR SHARE
)
UPDATE brain_deep_objectives d
 SET state='dispatching',updated_at=now()
 FROM control,profile
 WHERE d.task_key=$1 AND d.fingerprint=$2 AND d.state='prepared'
   AND NOT control.paused AND profile.owner='michaeljwilliams0123'
   AND profile.preset='release' AND profile.max_paid_cents=0
   AND profile.version=d.profile_version
   AND control.version=d.stop_version
 RETURNING d.task_key AS key,d.fingerprint,d.state`;
const UNKNOWN_SQL=`UPDATE brain_deep_objectives
 SET state='reconcile-required',updated_at=now()
 WHERE task_key=$1 AND fingerprint=$2 AND state='dispatching'
 RETURNING task_key AS key`;
const DONE_SQL=`UPDATE brain_deep_objectives
 SET state='observed',issue_number=$3,external_url=$4,updated_at=now()
 WHERE task_key=$1 AND fingerprint=$2
   AND state IN ('dispatching','reconcile-required')
 RETURNING task_key AS key,state,issue_number AS "issueNumber",external_url AS url`;
function result(row,reused=false){
 return Object.freeze({status:'completed',taskKey:row.key,
  externalIssueNumber:row.issueNumber,url:row.url,
  profileVersion:row.profileVersion,stopVersion:row.stopVersion,
  reused,productionAccepted:false});
}
function validateAction(value,key){
 const a=value?.action;
 if(value?.ok!==true||a?.action_key!==key||a.operation!=='issue.create'||
   a.state!=='observed'||a.result?.kind!=='issue'||
   !Number.isSafeInteger(a.result.number)||a.result.number<1||
   typeof a.result.url!=='string')return null;
 const url=URL.exec(a.result.url);
 return url&&Number(url[1])===a.result.number?
   {number:a.result.number,url:a.result.url}:null;
}
async function read(db,key){
 const response=await db.query(READ_SQL,[key]);
 if(!Array.isArray(response?.rows)||response.rows.length>1)
  throw Error('deep-objective-readback-unavailable');
 return response.rows[0]||null;
}
/**
 * send() MUST call the authenticated Mahoraga adapter for a new key only.
 * reconcile() MUST be strictly read-only or reconcile an already-dispatched
 * action; on absent/prepared action it must hold, never POST a new write.
 * observe() reads back its durable provider action receipt.
 */
export async function executeDeepIssue({db,send,reconcile,observe,request}={}){
 const q=requestCopy(request);
 if(!q||typeof db?.query!=='function'||typeof send!=='function'||
    typeof reconcile!=='function'||typeof observe!=='function')
  return stop('invalid-deep-task-request');
 const fp=await fingerprint(q);
 const action={key:q.key,operation:'issue.create',input:{
  title:q.title,body:q.body,expectedMainSha:q.expectedMainSha}};
 let row;
 try{row=await read(db,q.key);}catch{return stop('deep-task-ledger-unavailable');}
 if(row&&row.fingerprint!==fp)return stop('idempotency-conflict');
 if(!row){
  let auth;
  try{const r=await db.query(AUTH_SQL);auth=r?.rows?.length===1?r.rows[0]:null;}
  catch{return stop('owner-authority-unavailable');}
  if(auth?.owner!==OWNER||auth.preset!=='release'||
    auth.paused!==false||auth.maxPaidCents!==0||
    !Number.isSafeInteger(auth.version)||auth.version<1||
    !Number.isSafeInteger(auth.stopVersion)||auth.stopVersion<1)
   return stop('owner-grant-or-stop-denied');
  try{await db.query(ADMIT_SQL,[q.key,fp,auth.version,auth.stopVersion]);}
  catch{/* May have committed. Read back; never infer absence as permission. */}
  try{row=await read(db,q.key);}catch{return stop('deep-task-admission-uncertain');}
  if(!row)return stop('deep-task-admission-not-confirmed');
  if(row.fingerprint!==fp)return stop('idempotency-conflict');
 }
 if(row.state==='observed'){
  let external;
  try{external=validateAction(await observe(q.key),q.key);}
  catch{return {status:'reconcile-required',reason:'provider-observation-unavailable'};}
  if(!external||external.number!==row.issueNumber||external.url!==row.url)
   return {status:'reconcile-required',reason:'verified-provider-result-drift'};
  return result(row,true);
 }
 if(!['prepared','dispatching','reconcile-required'].includes(row.state))
  return stop('deep-task-unknown-state');
 let fresh=false;
 if(row.state==='prepared'){
  // No fresh dispatch after owner pause; historic sent/uncertain actions can
  // still be observed without introducing a new mutation.
  let auth;
  try{const r=await db.query(AUTH_SQL);auth=r?.rows?.length===1?r.rows[0]:null;}
  catch{return stop('owner-authority-unavailable');}
  if(auth?.owner!==OWNER||auth.preset!=='release'||auth.paused!==false||
     auth.maxPaidCents!==0||auth.version!==row.profileVersion||
     auth.stopVersion!==row.stopVersion)
   return stop('owner-grant-or-stop-denied');
  let claimed;
  try{claimed=await db.query(CLAIM_SQL,[q.key,fp]);}
  catch{return {status:'reconcile-required',reason:'dispatch-intent-write-uncertain'};}
  if(claimed?.rows?.length!==1)
   return {status:'reconcile-required',reason:'dispatch-intent-ownership-lost'};
  fresh=true;
 }
 if(fresh){
  try{await send(action);}
  catch{/* The provider may have committed: reconcile by readback only. */}
 }else{
  try{await reconcile(action);}
  catch{/* Unknown provider state still cannot authorize another send. */}
 }
 let external;
 try{external=validateAction(await observe(q.key),q.key);}
 catch{/* unavailable observation: hold */}
 if(!external){
  try{await db.query(UNKNOWN_SQL,[q.key,fp]);}catch{}
  return {status:'reconcile-required',reason:'external-outcome-not-confirmed',
   taskKey:q.key,productionAccepted:false};
 }
 try{await db.query(DONE_SQL,[q.key,fp,external.number,external.url]);}
 catch{/* Completion may have committed; do one independent DB readback. */}
 let saved;
 try{saved=await read(db,q.key);}catch{return{status:'reconcile-required',reason:'completion-readback-unavailable'};}
 if(saved?.state!=='observed'||saved.fingerprint!==fp||
    saved.issueNumber!==external.number||saved.url!==external.url)
  return{status:'reconcile-required',reason:'completion-not-persisted'};
 return result(saved);
}
