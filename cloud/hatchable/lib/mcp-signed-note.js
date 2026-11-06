import {cloudNoteBinding} from 'lib/cloud-native-action.js';
import {verifyDelegatedGrant} from 'lib/security-adjudicator.js';

const operation='cloud.note.create';
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

export async function prepareSignedNote(request){
 try{
  const {input,fingerprint}=await cloudNoteBinding(request);
  return {ok:true,grantRequest:{actor:'mcp:ultron',objectiveId:input.key,
   operation,resource:'sha256:'+fingerprint,administrativeChange:false}};
 }catch{return held('invalid-cloud-action');}
}

const READ=`SELECT n.id,n.kind,n.body,n.fingerprint,
 e.id AS "receiptId",e.details->>'grant_id' AS "grantId"
 FROM brain_notes n LEFT JOIN brain_events e
 ON e.event_type='mcp-cloud-note-observed'
 AND e.details->>'action_key'=n.action_key AND e.details->>'note_id'=n.id::text
 WHERE n.action_key=$1`;
const WRITE=`WITH authority AS MATERIALIZED (
 SELECT a.owner,a.preset,a.version,a.max_paid_cents,a.allowed_operations,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile a
 JOIN brain_runtime_control c ON c.id=1 WHERE a.id=1 FOR SHARE
), grant_row AS (
 INSERT INTO brain_authority_grants
 (grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $7,$1,'mcp:ultron','cloud.note.create',$8,$9,$10::timestamptz
 FROM authority WHERE owner='michaeljwilliams0123'
 AND preset IN ('build','release') AND version=$5 AND stop_version=$6
 AND NOT paused AND max_paid_cents=0
 AND jsonb_exists(allowed_operations,'cloud.note.create')
 AND $10::timestamptz>clock_timestamp()
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), grant_event AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'authority-grant-consumed',jsonb_build_object(
 'grantId',grant_id,'operation','cloud.note.create','policySha',$9::text)
 FROM grant_row RETURNING id
), created AS (
 INSERT INTO brain_notes(kind,body,action_key,fingerprint)
 SELECT $3,$4,$1,$2 FROM grant_row
 ON CONFLICT(action_key) DO NOTHING
 RETURNING id,action_key
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'mcp-cloud-note-observed',jsonb_build_object(
 'action_key',created.action_key,'note_id',created.id,
 'operation','cloud.note.create','grant_id',grant_row.grant_id)
 FROM created JOIN grant_row ON true RETURNING id
)
 SELECT created.id,receipt.id AS "receiptId" FROM created JOIN receipt ON true`;

async function read(db,input,fingerprint,grantId){
 const result=await db.query(READ,[input.key]);
 if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('ambiguous-readback');
 const row=result.rows[0];
 if(!row)return null;
 if(row.fingerprint!==fingerprint||row.kind!==input.kind||row.body!==input.body)
  return held('idempotency-conflict');
 if(!Number.isSafeInteger(row.id)||!Number.isSafeInteger(row.receiptId)||
    typeof row.grantId!=='string')
  return uncertain('receipt-unverified');
 if(row.grantId!==grantId)return held('grant-or-receipt-conflict');
 return {ok:true,status:'completed',operation,noteId:row.id,receiptId:row.receiptId};
}

export async function reconcileSignedNote({db,request,grantId}={}){
 let input,fingerprint;
 try{({input,fingerprint}=await cloudNoteBinding(request));}
 catch{return held('invalid-cloud-action');}
 if(typeof db?.query!=='function'||typeof grantId!=='string'||
  !/^[A-Za-z0-9_.:-]{8,128}$/.test(grantId))return held('invalid-readback-request');
 try{return (await read(db,input,fingerprint,grantId))??
  uncertain('receipt-not-yet-observed');}
 catch{return uncertain('readback-unavailable');}
}

export async function executeSignedNote({db,config,request,envelope}={}){
 let input,fingerprint;
 try{({input,fingerprint}=await cloudNoteBinding(request));}
 catch{return held('invalid-cloud-action');}
 if(typeof db?.query!=='function'||typeof config?.get!=='function')
  return held('authority-or-ledger-unavailable');
 let publicJwk;
 try{
  const raw=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
  if(typeof raw!=='string'||raw.length<20||raw.length>4096)throw Error('missing-key');
  publicJwk=JSON.parse(raw);
 }catch{return held('adjudicator-unconfigured');}
 let grant;
 try{
  grant=await verifyDelegatedGrant({envelope,publicJwk,request:{
   actor:'mcp:ultron',objectiveId:input.key,operation,
   resource:'sha256:'+fingerprint,administrativeChange:false
  }});
 }catch{return held('grant-invalid-or-expired');}
 let previous;
 try{previous=await read(db,input,fingerprint,grant.grantId);}
 catch{return uncertain('readback-unavailable');}
 if(previous)return {...previous,reused:previous.ok};
 let response;
 try{
  response=await db.query(WRITE,[input.key,fingerprint,input.kind,input.body,
   input.expectedProfileVersion,input.expectedStopVersion,grant.grantId,
   grant.resource,grant.policySha,grant.expiresAt]);
 }catch{
  // The write may have committed; only readback can settle its outcome.
 }
 let observed;
 try{observed=await read(db,input,fingerprint,grant.grantId);}
 catch{return uncertain('readback-unavailable');}
 if(!observed)return uncertain('write-or-authority-outcome-unresolved');
 if(!observed.ok)return observed;
 if(response&&(!Array.isArray(response.rows)||response.rows.length>1||
  (response.rows.length===1&&(response.rows[0].id!==observed.noteId||
   response.rows[0].receiptId!==observed.receiptId))))
  return uncertain('receipt-unverified');
 return {...observed,reused:!response||response.rows.length===0};
}
