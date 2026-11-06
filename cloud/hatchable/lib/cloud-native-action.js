/** One non-GitHub cloud effect with a durable, readback-verifiable receipt. */
const KEY=/^[a-z][a-z0-9_.:-]{7,119}$/;
const KINDS=new Set(['goal','observation','decision']);
const FINGERPRINT=/^[a-f0-9]{64}$/;

function copy(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 let fields;try{fields=Object.getOwnPropertyDescriptors(raw);}catch{return null;}
 if(Object.keys(fields).sort().join(',')!==
   'body,expectedProfileVersion,expectedStopVersion,key,kind')return null;
 const value=Object.create(null);
 for(const [key,descriptor] of Object.entries(fields)){
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return null;
  value[key]=descriptor.value;
 }
 if(typeof value.key!=='string'||!KEY.test(value.key)||
   !KINDS.has(value.kind)||typeof value.body!=='string'||
   !value.body.trim()||value.body.trim().length>1200||
   !Number.isSafeInteger(value.expectedProfileVersion)||value.expectedProfileVersion<1||
   !Number.isSafeInteger(value.expectedStopVersion)||value.expectedStopVersion<1)
  return null;
 value.body=value.body.trim();
 return Object.freeze(value);
}
async function digest(value){
 const bytes=new TextEncoder().encode(JSON.stringify([
  'ultron.cloud.note.v1',value.key,value.kind,value.body,
  value.expectedProfileVersion,value.expectedStopVersion
 ]));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function cloudNoteBinding(raw){
 const input=copy(raw);
 if(!input)throw Error('invalid-cloud-action');
 return {input,fingerprint:await digest(input)};
}
const READ_SQL=`SELECT n.id,n.kind,n.body,n.fingerprint,
 e.id AS "receiptId" FROM brain_notes n
 JOIN brain_events e ON e.event_type='cloud-action-observed'
  AND e.details->>'action_key'=n.action_key
  AND e.details->>'note_id'=n.id::text
 WHERE n.action_key=$1`;
const WRITE_SQL=`WITH authority AS MATERIALIZED (
 SELECT a.owner,a.preset,a.version,a.max_paid_cents,a.allowed_operations,
  c.paused,c.version AS stop_version
 FROM brain_owner_autonomy_profile a
 JOIN brain_runtime_control c ON c.id=1
 WHERE a.id=1 FOR SHARE
), created AS (
 INSERT INTO brain_notes(kind,body,action_key,fingerprint)
 SELECT $3,$4,$1,$2 FROM authority
 WHERE owner='michaeljwilliams0123' AND preset IN ('build','release')
  AND version=$5 AND stop_version=$6 AND NOT paused AND max_paid_cents=0
  AND jsonb_exists(allowed_operations,'cloud.note.create')
 ON CONFLICT(action_key) DO NOTHING
 RETURNING id,kind,body,action_key,fingerprint
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'cloud-action-observed',jsonb_build_object(
  'action_key',action_key,'note_id',id,'operation','cloud.note.create')
 FROM created RETURNING id
)
SELECT created.id,receipt.id AS "receiptId" FROM created JOIN receipt ON true`;
const held=reason=>Object.freeze({status:'held',reason,productionAccepted:false});
const pending=reason=>Object.freeze({status:'reconcile-required',reason,
 productionAccepted:false});

/** Replay is read-only. A lost database response is resolved by keyed readback. */
export async function executeCloudNote({db,request}={}){
 const input=copy(request);
 if(!input||typeof db?.query!=='function')return held('invalid-cloud-action');
 const fingerprint=await digest(input);
 if(!FINGERPRINT.test(fingerprint))return held('invalid-cloud-action');
 const read=async()=>{
  const response=await db.query(READ_SQL,[input.key]);
  if(!Array.isArray(response?.rows)||response.rows.length>1)
   throw Error('cloud-action-readback-ambiguous');
  return response.rows[0]??null;
 };
 let existing;
 try{existing=await read();}catch{return pending('readback-unavailable');}
 if(existing){
  if(existing.fingerprint!==fingerprint||existing.kind!==input.kind||
     existing.body!==input.body)return held('idempotency-conflict');
  if(!Number.isSafeInteger(existing.id)||!Number.isSafeInteger(existing.receiptId))
   return pending('receipt-unverified');
  return Object.freeze({status:'completed',operation:'cloud.note.create',
   noteId:existing.id,receiptId:existing.receiptId,reused:true,
   productionAccepted:false});
 }
 let response,failed=false;
 try{response=await db.query(WRITE_SQL,[input.key,fingerprint,input.kind,
  input.body,input.expectedProfileVersion,input.expectedStopVersion]);}
 catch{failed=true;}
 let stored;
 try{stored=await read();}catch{return pending('readback-unavailable');}
 if(!stored)return failed?pending('write-outcome-unknown'):
  held('owner-profile-or-stop-denied');
 if(stored.fingerprint!==fingerprint||stored.kind!==input.kind||
    stored.body!==input.body)return held('idempotency-conflict');
 if(!Number.isSafeInteger(stored.id)||!Number.isSafeInteger(stored.receiptId)||
    (!Array.isArray(response?.rows)&&!failed)||
    (response?.rows?.length===1&&
      (response.rows[0].id!==stored.id||response.rows[0].receiptId!==stored.receiptId)))
  return pending('receipt-unverified');
 return Object.freeze({status:'completed',operation:'cloud.note.create',
  noteId:stored.id,receiptId:stored.receiptId,
  reused:failed||response.rows.length===0,productionAccepted:false});
}
