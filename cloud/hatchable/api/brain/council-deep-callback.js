import {db,webhooks,config,events} from 'hatchable';

export const access='public';
export const methods=['POST'];

const SIGNATURE=/^sha256=([a-f0-9]{64})$/;
const TASK_ID=/^[1-9][0-9]{0,15}$/;
const HEX64=/^[a-f0-9]{64}$/;
const ROOM=/^(?:owner-main|chat-[a-f0-9-]{36})$/;
const ROLES=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];

function reply(res,status,value){
 res.setHeader('cache-control','no-store');
 return res.status(status).json({schema:'ultron.council-deep-callback.v1',...value});
}
function rawBytes(value){
 if(typeof value==='string')return new TextEncoder().encode(value);
 if(value instanceof Uint8Array)return value;
 return null;
}
function clean(value,max=1200){
 return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
}
function validatePayload(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    body.schema!=='ultron.council-deep-callback.v1')
  throw Error('callback-schema-invalid');
 const taskId=String(body.taskId??'').trim();
 const requestDigest=String(body.requestDigest??'').trim().toLowerCase();
 const roomKey=String(body.roomKey??'').trim();
 if(!TASK_ID.test(taskId)||!HEX64.test(requestDigest)||!ROOM.test(roomKey))
  throw Error('callback-target-invalid');
 if(!body.results||typeof body.results!=='object'||Array.isArray(body.results))
  throw Error('callback-results-invalid');
 const members=[];
 for(const role of ROLES){
  const r=body.results[role];
  if(!r||typeof r!=='object')continue;
  const id=role.toLowerCase();
  const verdict=String(r.verdict||'hold');
  const confidence=Number.isFinite(Number(r.confidence))?
   Math.min(1,Math.max(0,Number(r.confidence))):0;
  const basis=r.source==='model'&&r.provider&&r.modelId
   ?`[${r.provider}/${r.modelId} · ${verdict} (${confidence.toFixed(2)})] `
   :`[fallback:${clean(r.fallbackReason||'unavailable',40)} · ${verdict}] `;
  const rationale=clean(r.rationale||'No rationale provided.',900);
  const findings=Array.isArray(r.findings)?r.findings.slice(0,3).map(x=>clean(x,180)):[];
  const tests=Array.isArray(r.tests)?r.tests.slice(0,3).map(x=>clean(x,180)):[];
  members.push({
   role,id,
   body:clean(basis+rationale+(findings.length?' Findings: '+findings.join('; '):''),1200),
   kind:id==='builder'?'action':'inference',
   status:'complete',
   source:clean(r.source||'unknown',40),
   provider:r.provider?clean(r.provider,40):null,
   modelId:r.modelId?clean(r.modelId,80):null,
   verdict,confidence,findings,tests
  });
 }
 if(!members.length)throw Error('callback-members-empty');
 const runId=String(body.runId??'').trim();
 const runUrl=typeof body.runUrl==='string'&&
  /^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/actions\/runs\/[0-9]+$/.test(body.runUrl)
  ?body.runUrl:null;
 const modelInvocations=Number.isSafeInteger(Number(body.modelInvocations))
  ?Number(body.modelInvocations):0;
 const aiReasoned=body.aiReasoned===true;
 const disagreement=body.disagreement===true;
 const summary=clean(body.summary||
  `Deep reasoning completed (${modelInvocations}/7 model-backed roles).`,500);
 return {
  taskId,requestDigest,roomKey,members,runId,runUrl,
  modelInvocations,aiReasoned,disagreement,summary,
  at:typeof body.at==='string'?clean(body.at,40):new Date().toISOString()
 };
}

export default async function(req,res){
 const headers=req.headers||{};
 const signature=String(headers['x-ultron-signature-256']||'');
 const bytes=rawBytes(req.rawBody);
 if(!SIGNATURE.test(signature)||!bytes||bytes.length<2||bytes.length>250000)
  return reply(res,403,{ok:false,error:'signature-required'});

 let secret;
 try{
  secret=await config.get('ULTRON_EVENT_BRIDGE_HMAC_KEY');
  if(typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
   throw Error('unconfigured');
 }catch{
  return reply(res,503,{ok:false,error:'callback-hmac-not-configured'});
 }

 let verified=false;
 try{
  verified=await webhooks.verifyHmac({
   raw:req.rawBody,signature:signature.slice(7),secret,
   algorithm:'sha256',encoding:'hex'
  });
 }catch{}
 if(!verified)return reply(res,403,{ok:false,error:'signature-invalid'});

 let payload;
 try{payload=validatePayload(req.body);}
 catch(error){return reply(res,422,{ok:false,error:error.message});}

 const existing=(await db.query(
  `SELECT t.id,t.task_key,t.status,t.last_result,
          j.id AS job_id,j.message_id,j.request_digest,m.room_key
   FROM brain_tasks t
   JOIN council_room_jobs j ON j.task_id=t.id
   JOIN council_room_messages m ON m.id=j.message_id
   WHERE t.id=$1 AND t.objective='council.room' AND m.room_key=$2
   LIMIT 1`,
  [payload.taskId,payload.roomKey]
 )).rows[0];
 if(!existing)return reply(res,404,{ok:false,error:'council-task-not-found'});

 const expectedDigest=existing.request_digest||
  existing.last_result?.reasoningBridge?.requestDigest||null;
 if(!HEX64.test(expectedDigest||''))
  return reply(res,409,{ok:false,error:'request-digest-unbound'});
 if(expectedDigest!==payload.requestDigest)
  return reply(res,409,{ok:false,error:'request-digest-mismatch'});

 const prior=existing.last_result&&typeof existing.last_result==='object'
  ?existing.last_result:{};
 const companionMember=payload.members.find(m=>m.id==='companion');
 const updatedResult={
  ...prior,
  objective:'council.room',
  at:payload.at,
  source:'github-council-deep-callback',
  summary:payload.summary,
  members:payload.members,
  ...(companionMember?{companion:{
   id:'companion',role:'Companion',kind:'result',lead:true,
   body:companionMember.body
  }}:{}),
  reasoningBridge:{
   ...(prior.reasoningBridge||{}),
   mode:'deep',
   engine:'github-council-gemini-groq',
   status:'complete',
   requestDigest:payload.requestDigest,
   runId:payload.runId||null,
   runUrl:payload.runUrl,
   modelInvocations:payload.modelInvocations,
   aiReasoned:payload.aiReasoned,
   disagreement:payload.disagreement,
   completedAt:payload.at,
   paidCents:0
  },
  paidCents:0
 };

 const messageKey='deep:'+payload.taskId+':'+payload.requestDigest.slice(0,16);
 const jobIdempotencyKey='council-deep:'+payload.taskId+':'+payload.requestDigest.slice(0,16);
 const msgContext={
  taskId:Number(payload.taskId),
  reasoningMode:'deep',
  requestDigest:payload.requestDigest,
  runId:payload.runId||null,
  runUrl:payload.runUrl,
  modelInvocations:payload.modelInvocations,
  aiReasoned:payload.aiReasoned,
  disagreement:payload.disagreement
 };
 const execResult={
  requestDigest:payload.requestDigest,
  runId:payload.runId||null,
  runUrl:payload.runUrl,
  modelInvocations:payload.modelInvocations,
  aiReasoned:payload.aiReasoned,
  disagreement:payload.disagreement,
  completedAt:payload.at
 };

 await db.query(
  `WITH task_upd AS (
    UPDATE brain_tasks
    SET status='done',last_result=$2::jsonb,updated_at=now()
    WHERE id=$1
    RETURNING id
   ), job_upd AS (
    UPDATE council_room_jobs
    SET state='done',
        execution_state='verified',
        external_id=COALESCE($3,external_id),
        external_kind=CASE WHEN $4::text IS NOT NULL THEN 'workflow_run' ELSE external_kind END,
        external_url=COALESCE($4,external_url),
        idempotency_key=COALESCE(idempotency_key,$11),
        request_digest=COALESCE(request_digest,$5),
        execution_result=$6::jsonb,
        updated_at=now()
    WHERE task_id=$1
    RETURNING id
   ), msg_ins AS (
    INSERT INTO council_room_messages(message_key,room_key,author_type,author_id,kind,body,mentions,context)
    VALUES($7,$8,'system','council-deep','result',$9,'[]'::jsonb,$10::jsonb)
    ON CONFLICT(message_key) DO NOTHING
    RETURNING id
   ), thread_upd AS (
    UPDATE council_room_threads SET updated_at=now() WHERE room_key=$8
    RETURNING room_key
   )
   SELECT (SELECT id FROM task_upd) AS task_id,
          (SELECT id FROM job_upd) AS job_id,
          (SELECT id FROM msg_ins) AS inserted_message_id`,
  [
   payload.taskId,
   JSON.stringify(updatedResult),
   payload.runId||null,
   payload.runUrl,
   payload.requestDigest,
   JSON.stringify(execResult),
   messageKey,
   payload.roomKey,
   payload.summary,
   JSON.stringify(msgContext),
   jobIdempotencyKey
  ]
 );

 try{
  await events.publish('ultron.owner','council-room',{
   messageId:existing.message_id,
   taskId:Number(payload.taskId),
   deep:true
  });
 }catch{}

 return reply(res,200,{
  ok:true,
  taskId:Number(payload.taskId),
  roomKey:payload.roomKey,
  modelInvocations:payload.modelInvocations,
  aiReasoned:payload.aiReasoned,
  runUrl:payload.runUrl
 });
}