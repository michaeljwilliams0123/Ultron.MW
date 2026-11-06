import {verifyDelegatedGrant} from 'lib/security-adjudicator.js';
import {notifyOwner} from 'lib/owner-live-events.js';

const objectives=new Set(['repo.inspect','repo.prs','repo.ci','site.render','council.review']);
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

async function binding(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid-request');
 const fields=Object.getOwnPropertyDescriptors(raw),value=Object.create(null);
 for(const [key,descriptor] of Object.entries(fields)){
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('invalid-request');
  value[key]=descriptor.value;
 }
 const queue=value.operation==='mcp.queue.submit';
 const control=value.operation==='mcp.task.control';
 const expected=queue?'expectedProfileVersion,expectedStopVersion,key,objective,operation':
  'action,expectedProfileVersion,expectedStopVersion,id,key,operation';
 if((!queue&&!control)||Object.keys(value).sort().join(',')!==expected||
  typeof value.key!=='string'||!/^[a-z0-9-]{6,80}$/.test(value.key)||
  !Number.isSafeInteger(value.expectedProfileVersion)||value.expectedProfileVersion<1||
  !Number.isSafeInteger(value.expectedStopVersion)||value.expectedStopVersion<1||
  (queue&&!objectives.has(value.objective))||
  (control&&(!['cancel','retry','unblock'].includes(value.action)||
    !Number.isSafeInteger(value.id)||value.id<1||value.id>1000000000)))
  throw Error('invalid-request');
 const canonical=JSON.stringify(['ultron.mcp.mutation.v1',value.operation,value.key,
  queue?value.objective:value.action,queue?null:value.id,
  value.expectedProfileVersion,value.expectedStopVersion]);
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
 return {value,fingerprint:[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')};
}

export async function prepareMutation(request){
 try{
  const {value,fingerprint}=await binding(request);
  return {ok:true,grantRequest:{actor:'mcp:ultron',objectiveId:value.key,
   operation:value.operation,resource:'sha256:'+fingerprint,administrativeChange:false}};
 }catch{return held('invalid-request');}
}

const READ=`SELECT m.fingerprint,m.operation,m.grant_id,e.id AS "receiptId",
 e.details->>'outcome' AS outcome,e.task_id AS "taskId"
 FROM brain_mcp_mutations m LEFT JOIN brain_events e
 ON e.event_type='mcp-mutation-observed' AND e.details->>'action_key'=m.action_key
 WHERE m.action_key=$1`;
const WRITE=`WITH authority AS MATERIALIZED (
 SELECT a.owner,a.preset,a.version,a.max_paid_cents,a.allowed_operations,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile a
 JOIN brain_runtime_control c ON c.id=1 WHERE a.id=1 FOR SHARE
), grant_row AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $7,$1,'mcp:ultron',$3,$8,$9,$10::timestamptz FROM authority
 WHERE owner='michaeljwilliams0123' AND preset IN ('build','release')
 AND version=$5 AND stop_version=$6 AND NOT paused AND max_paid_cents=0
 AND jsonb_exists(allowed_operations,$3::text)
 AND $10::timestamptz>clock_timestamp()
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), admitted AS (
 INSERT INTO brain_mcp_mutations(action_key,fingerprint,operation,grant_id)
 SELECT $1,$2,$3,grant_id FROM grant_row
 ON CONFLICT(action_key) DO NOTHING RETURNING action_key,operation,grant_id
), queued AS (
 INSERT INTO brain_tasks(task_key,objective)
 SELECT 'mcp:' || action_key,$4 FROM admitted WHERE operation='mcp.queue.submit'
 ON CONFLICT(task_key) DO NOTHING RETURNING id,objective
), moved AS (
 UPDATE brain_tasks t SET status=CASE WHEN $4='cancel' THEN 'canceled' ELSE 'queued' END,
 attempts=CASE WHEN $4='cancel' THEN attempts ELSE 0 END,
 owner_token=NULL,lease_until=NULL,updated_at=now()
 FROM admitted WHERE admitted.operation='mcp.task.control' AND t.id=$11
 AND (($4='cancel' AND t.status IN ('queued','blocked')) OR
  ($4 IN ('retry','unblock') AND t.status='blocked'))
 RETURNING t.id
), queue_event AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT id,'owner-queued',jsonb_build_object('objective',objective) FROM queued RETURNING id
), grant_event AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'authority-grant-consumed',jsonb_build_object('grantId',grant_id,
 'operation',$3::text,'policySha',$9::text) FROM grant_row RETURNING id
), receipt AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT COALESCE((SELECT id FROM queued),(SELECT id FROM moved)),
 'mcp-mutation-observed',jsonb_build_object('action_key',action_key,
 'operation',operation,'grant_id',grant_id,
 'outcome',CASE WHEN EXISTS(SELECT 1 FROM queued) OR EXISTS(SELECT 1 FROM moved)
 THEN 'applied' ELSE 'denied' END)
 FROM admitted RETURNING id
)
 SELECT id AS "receiptId" FROM receipt`;

async function read(db,value,fingerprint,grantId){
 const result=await db.query(READ,[value.key]);
 if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('ambiguous-readback');
 const row=result.rows[0];
 if(!row)return null;
 if(row.fingerprint!==fingerprint||row.operation!==value.operation)
  return held('idempotency-conflict');
 if(row.grant_id!==grantId)return held('grant-conflict');
 if(!Number.isSafeInteger(row.receiptId)||!['applied','denied'].includes(row.outcome)||
  (row.outcome==='applied'&&!Number.isSafeInteger(row.taskId)))
  return uncertain('receipt-unverified');
 return {ok:row.outcome==='applied',status:row.outcome,receiptId:row.receiptId,taskId:row.taskId};
}

export async function reconcileMutation({db,request,grantId}={}){
 let bound;
 try{bound=await binding(request);}catch{return held('invalid-request');}
 if(typeof db?.query!=='function'||typeof grantId!=='string'||
  !/^[A-Za-z0-9_.:-]{8,128}$/.test(grantId))return held('invalid-readback-request');
 try{return (await read(db,bound.value,bound.fingerprint,grantId))??
  uncertain('receipt-not-yet-observed');}catch{return uncertain('readback-unavailable');}
}

export async function executeMutation({db,config,events,request,envelope}={}){
 let bound;
 try{bound=await binding(request);}catch{return held('invalid-request');}
 if(typeof db?.query!=='function'||typeof config?.get!=='function')
  return held('authority-or-ledger-unavailable');
 let key;
 try{
  const raw=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
  if(typeof raw!=='string'||raw.length<20||raw.length>4096)throw Error('missing-key');
  key=JSON.parse(raw);
 }catch{return held('adjudicator-unconfigured');}
 const {value,fingerprint}=bound;
 let grant;
 try{grant=await verifyDelegatedGrant({envelope,publicJwk:key,request:{
  actor:'mcp:ultron',objectiveId:value.key,operation:value.operation,
  resource:'sha256:'+fingerprint,administrativeChange:false
 }});}catch{return held('grant-invalid-or-expired');}
 let prior;
 try{prior=await read(db,value,fingerprint,grant.grantId);}
 catch{return uncertain('readback-unavailable');}
 if(prior)return {...prior,reused:true};
 let response;
 try{response=await db.query(WRITE,[value.key,fingerprint,value.operation,
  value.objective??value.action,value.expectedProfileVersion,value.expectedStopVersion,
  grant.grantId,grant.resource,grant.policySha,grant.expiresAt,value.id??null]);}
 catch{/* The operation may have committed; reconcile without repeating it. */}
 let result;
 try{result=await read(db,value,fingerprint,grant.grantId);}
 catch{return uncertain('readback-unavailable');}
 if(!result)return uncertain('write-or-authority-outcome-unresolved');
 if(result.status==='held'||result.status==='reconcile-required')return result;
 if(response&&(!Array.isArray(response.rows)||response.rows.length>1||
  (response.rows.length===1&&response.rows[0].receiptId!==result.receiptId)))
  return uncertain('receipt-unverified');
 const reused=!response||response.rows.length===0;
 if(!reused&&result.ok)await notifyOwner(events,'task',result.taskId);
 return {...result,reused};
}
