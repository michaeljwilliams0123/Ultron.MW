import {db,scheduler,events} from 'hatchable';
import {verifyCouncilRoomExecutionOidc} from 'lib/council-oidc.js';
import {createHash} from 'node:crypto';

export const access='public';
export const methods=['POST'];

const REPO='michaeljwilliams0123/Ultron.MW';
const SECRET_LIKE=/(?:password|passcode|otp|api[_ -]?key|private[_ -]?key)\s*[:=]|\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i;
const SHA=/^[a-f0-9]{40}$/;
const RUN_URL=new RegExp('^https://github\\.com/'+REPO.replace('/','\\/')+
 '/actions/runs/(\\d+)$');
const PR_URL=new RegExp('^https://github\\.com/'+REPO.replace('/','\\/')+
 '/pull/(\\d+)$');

function response(res,status,value){
 res.setHeader('cache-control','no-store');
 return res.status(status).json({schema:'ultron.council-room.execution.v1',...value});
}
function rawBody(req){
 if(typeof req.rawBody==='string')return req.rawBody;
 if(req.rawBody instanceof Uint8Array)
  return new TextDecoder('utf-8',{fatal:true}).decode(req.rawBody);
 return null;
}
function cleanString(value,max){
 return typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
}
function parseRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    body.schema!=='ultron.council-room.execution.v1'||
    !['planned','reserve','dispatched','observing','verified','blocked','needs-owner'].includes(body.phase)||
    !Number.isSafeInteger(body.issueNumber)||body.issueNumber<1||
    !Number.isSafeInteger(body.commentId)||body.commentId<1||
    !cleanString(body.commentBody,6000))
  throw Error('execution-request-invalid');
 const allowed=new Set(['schema','phase','issueNumber','commentId','commentBody',
  'artifact','verification','result']);
 if(Object.keys(body).some(key=>!allowed.has(key)))throw Error('execution-request-invalid');
 const match=body.commentBody.match(/^\s*@ultron implement ([^\r\n]+)\s*$/i);
 const objective=match?.[1]?.trim();
 if(!objective||objective.length<5||objective.length>1000||
    /[\u0000-\u001f]/.test(objective)||SECRET_LIKE.test(objective))
  throw Error('execution-objective-invalid');
 const requestDigest=createHash('sha256').update(
  JSON.stringify({issueNumber:body.issueNumber,objective})).digest('hex');
 const idempotencyKey='room:issue:'+body.issueNumber+':'+requestDigest.slice(0,40);
 return {body,objective,requestDigest,idempotencyKey,messageKey:idempotencyKey};
}
function externalArtifact(body,phase){
 if(phase==='dispatched'){
  const artifact=body.artifact;
  const match=typeof artifact?.url==='string'?artifact.url.match(PR_URL):null;
  if(artifact?.kind!=='pull_request'||!match||
    String(match[1])!==String(artifact.id)||!SHA.test(artifact.headSha||'')||
    artifact.branch!=='ultron/issue-'+body.issueNumber)
   throw Error('execution-artifact-invalid');
  return {id:String(artifact.id),url:artifact.url,kind:artifact.kind,
    headSha:artifact.headSha};
 }
 if(phase==='observing'||phase==='verified'||phase==='blocked'){
  const verification=body.verification;
  if(verification!==undefined){
   const match=typeof verification.url==='string'?verification.url.match(RUN_URL):null;
   if(!match||String(match[1])!==String(verification.runId)||
     !SHA.test(verification.sha||'')||
     !['success','failure','cancelled','timed_out','action_required','neutral','skipped'].includes(verification.conclusion))
    throw Error('execution-verification-invalid');
  }
  if(phase==='verified'&&verification?.conclusion!=='success')
   throw Error('execution-success-receipt-invalid');
  if(phase==='blocked'&&(!cleanString(body.result?.reason,240)||
    !body.result.reason.trim()))throw Error('execution-result-invalid');
  return verification?{
   runId:String(verification.runId),url:verification.url,
   sha:verification.sha,conclusion:verification.conclusion,
   ...(phase==='blocked'?{reason:body.result.reason.trim()}:{})
  }:phase==='blocked'?{reason:body.result.reason.trim()}:null;
 }
 if(phase==='blocked'||phase==='needs-owner'){
  const reason=body.result?.reason;
  if(!cleanString(reason,240)||!reason.trim())throw Error('execution-result-invalid');
  return {reason:reason.trim()};
 }
 return null;
}
function publicJob(row){
 return {id:row.job_id,messageId:String(row.message_id),
  state:row.execution_state,idempotencyKey:row.idempotency_key,
  externalId:row.external_id||null,externalKind:row.external_kind||null,
  externalUrl:row.external_url||null,result:row.execution_result||{}};
}
function resultMatches(current,expected){
 return Object.entries(expected||{}).every(([key,value])=>
  current?.[key]===value);
}
async function planned(res,request){
 const {body,objective,requestDigest,idempotencyKey,messageKey}=request;
 const context={repositories:[REPO],includeMahoraga:true,
  source:'github-owner-comment',issueNumber:body.issueNumber,
  commentId:body.commentId,requestDigest};
 const rows=(await db.query(`WITH inserted AS (
   INSERT INTO council_room_messages(message_key,author_type,author_id,kind,body,context)
   VALUES($1,'owner','michaeljwilliams0123','action',$2,$3::jsonb)
   ON CONFLICT(message_key) DO NOTHING RETURNING id
 ), chosen AS (
   SELECT id FROM inserted UNION ALL
   SELECT id FROM council_room_messages WHERE message_key=$1 LIMIT 1
 ), task_insert AS (
   INSERT INTO brain_tasks(task_key,objective)
   SELECT 'room:'||id::text,'council.room' FROM chosen
   ON CONFLICT(task_key) DO NOTHING RETURNING id,task_key
 ), task_chosen AS (
   SELECT id,task_key FROM task_insert UNION ALL
   SELECT t.id,t.task_key FROM brain_tasks t JOIN chosen c
    ON t.task_key='room:'||c.id::text LIMIT 1
 ), job_insert AS (
   INSERT INTO council_room_jobs(message_id,task_id,execution_state,
    idempotency_key,request_digest)
   SELECT c.id,t.id,'planned',$4,$5 FROM chosen c CROSS JOIN task_chosen t
   ON CONFLICT(message_id) DO NOTHING RETURNING id
 )
 SELECT m.id AS message_id,m.body,j.id AS job_id,j.execution_state,
   j.idempotency_key,j.request_digest,j.external_id,j.external_kind,
   j.external_url,j.execution_result,
   EXISTS(SELECT 1 FROM inserted) AS created
 FROM chosen c JOIN council_room_messages m ON m.id=c.id
 JOIN task_chosen t ON TRUE
 JOIN council_room_jobs j ON j.message_id=m.id`,
 [messageKey,'@ultron implement '+objective,JSON.stringify(context),
  idempotencyKey,requestDigest])).rows;
 const row=rows[0];
 if(!row)return response(res,409,{ok:false,error:'execution-job-conflict'});
 if(row.idempotency_key!==idempotencyKey||row.request_digest!==requestDigest||
    row.body!=='@ultron implement '+objective)
  return response(res,409,{ok:false,error:'execution-idempotency-conflict'});
 const warnings=[];
 if(row.created){
  try{await scheduler.now('/api/brain/run',{via:'council-room-execution'});}
  catch{warnings.push('brain-run-scheduling-failed');}
  try{await events.publish('ultron.owner','council-room',{messageId:row.message_id});}
  catch{warnings.push('council-room-event-publish-failed');}
 }
 return response(res,200,{ok:true,created:!!row.created,job:publicJob(row),warnings});
}
async function update(res,request){
 const {body,idempotencyKey,requestDigest}=request;
 const phase=body.phase;
 let result;
 try{result=externalArtifact(body,phase);}catch(error){
  return response(res,422,{ok:false,error:error.message});
 }
 let updated;
 if(phase==='reserve'){
  updated=(await db.query(`WITH control AS MATERIALIZED (
   SELECT paused FROM brain_runtime_control WHERE id=1 FOR SHARE
  ), changed AS (
   UPDATE council_room_jobs j SET
    execution_state=CASE WHEN c.paused THEN 'needs-owner' ELSE 'dispatching' END,
    execution_result=CASE WHEN c.paused THEN '{"reason":"owner-paused"}'::jsonb ELSE '{}'::jsonb END,
    updated_at=now()
   FROM control c
   WHERE j.idempotency_key=$1 AND j.request_digest=$2
    AND (j.execution_state='planned' OR
     (j.execution_state='needs-owner' AND
      j.execution_result->>'reason'='owner-paused' AND j.external_id IS NULL))
   RETURNING j.id
  )
  SELECT j.*,m.id AS message_id,
   EXISTS(SELECT 1 FROM changed c WHERE c.id=j.id) AS transitioned
  FROM council_room_jobs j JOIN council_room_messages m ON m.id=j.message_id
  WHERE j.idempotency_key=$1 AND j.request_digest=$2 LIMIT 1`,
  [idempotencyKey,requestDigest])).rows[0];
 }else if(phase==='dispatched'){
  updated=(await db.query(`UPDATE council_room_jobs SET execution_state='dispatched',
    external_id=$3,external_kind='pull_request',external_url=$4,
    execution_result=jsonb_build_object('headSha',$5::text),updated_at=now()
   WHERE idempotency_key=$1 AND request_digest=$2 AND execution_state='dispatching'
   RETURNING *`,
   [idempotencyKey,requestDigest,result.id,result.url,result.headSha])).rows[0];
 }else if(phase==='observing'){
  updated=(await db.query(`UPDATE council_room_jobs SET execution_state='observing',
    execution_result=execution_result || $3::jsonb,updated_at=now()
   WHERE idempotency_key=$1 AND request_digest=$2
    AND execution_state IN ('dispatched','observing')
    AND external_id IS NOT NULL AND ($4::text IS NULL OR
     execution_result->>'headSha'=$4)
   RETURNING *`,
   [idempotencyKey,requestDigest,JSON.stringify(result||{}),result?.sha||null])).rows[0];
 }else if(['verified','blocked','needs-owner'].includes(phase)){
  updated=(await db.query(`UPDATE council_room_jobs SET execution_state=$3,
    execution_result=execution_result || $4::jsonb,updated_at=now()
   WHERE idempotency_key=$1 AND request_digest=$2
    AND (execution_state='observing' OR
     ($3='needs-owner' AND execution_state IN ('planned','dispatching','dispatched','observing')))
    AND ($5::text IS NULL OR execution_result->>'headSha'=$5)
   RETURNING *`,
   [idempotencyKey,requestDigest,phase,JSON.stringify(result||{}),result?.sha||null])).rows[0];
 }
 if(!updated){
  const existing=(await db.query(`SELECT j.*,m.id AS message_id
   FROM council_room_jobs j JOIN council_room_messages m ON m.id=j.message_id
   WHERE j.idempotency_key=$1 AND j.request_digest=$2 LIMIT 1`,
   [idempotencyKey,requestDigest])).rows[0];
  if(!existing)return response(res,404,{ok:false,error:'execution-job-not-found'});
  const same=phase==='reserve'&&
    ['dispatching','needs-owner','dispatched','observing','verified','blocked'].includes(existing.execution_state)||
   phase===existing.execution_state&&
    (phase==='dispatched'?
      existing.external_id===result.id&&existing.external_url===result.url:
     phase==='observing'?
       resultMatches(existing.execution_result,result):
     ['verified','blocked','needs-owner'].includes(phase)?
       resultMatches(existing.execution_result,result):true);
  if(!same)return response(res,409,{ok:false,error:'execution-transition-conflict',job:publicJob(existing)});
  updated=existing;
 }
 const row=updated.message_id?updated:(await db.query(`SELECT j.*,m.id AS message_id
  FROM council_room_jobs j JOIN council_room_messages m ON m.id=j.message_id
  WHERE j.id=$1 LIMIT 1`,[updated.id])).rows[0];
 if(!row)return response(res,500,{ok:false,error:'execution-job-readback-failed'});
 return response(res,200,{ok:true,job:publicJob(row)});
}
export default async function handler(req,res){
 const raw=rawBody(req);
 if(!raw||raw.length>100000)return response(res,400,{ok:false,error:'request-invalid'});
 const authorization=req.headers?.authorization||req.headers?.Authorization;
 if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9._-]{250,20000}$/.test(authorization))
  return response(res,403,{ok:false,error:'oidc-required'});
 let identity,body,request;
 try{
  identity=await verifyCouncilRoomExecutionOidc({token:authorization.slice(7),rawBody:raw});
  body=JSON.parse(raw);
  if(identity.actor!=='michaeljwilliams0123'||identity.event!=='issue_comment')
   throw Error('execution-identity-invalid');
  request=parseRequest(body);
 }catch{
  return response(res,403,{ok:false,error:'oidc-invalid'});
 }
 if(body.phase==='planned')return planned(res,request);
 return update(res,request);
}
