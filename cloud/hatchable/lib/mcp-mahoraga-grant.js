import {verifyDelegatedGrant} from 'lib/security-adjudicator.js';
import {validateMahoragaAction,runMahoragaAction,mahoragaActionStatus} from 'lib/mahoraga-actions.js';

const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
const operationFor=operation=>operation==='issue.create'?'repo.issue.create':'repo.verify.dispatch';

function dataObject(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-request');
 const result=Object.create(null);
 for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('invalid-request');
  result[key]=descriptor.value;
 }
 return result;
}
async function bind(request){
 const input=dataObject(request);
 if(Object.keys(input).sort().join(',')!=='action,expectedProfileVersion,expectedStopVersion'||
  !Number.isSafeInteger(input.expectedProfileVersion)||input.expectedProfileVersion<1||
  !Number.isSafeInteger(input.expectedStopVersion)||input.expectedStopVersion<1)
  throw Error('invalid-request');
 const raw=dataObject(input.action);
 if(Object.keys(raw).sort().join(',')!=='input,key,operation')
  throw Error('invalid-request');
 raw.input=dataObject(raw.input);
 const action=validateMahoragaAction(raw);
 if(Object.keys(raw.input).sort().join(',')!==Object.keys(action.input).sort().join(','))
  throw Error('invalid-request');
 const operation=operationFor(action.operation);
 const canonical=JSON.stringify(['ultron.mcp.mahoraga.v1',action.key,action.operation,
  action.operation==='issue.create'?[action.input.title,action.input.body,action.input.expectedMainSha]:
   [action.input.ref,action.input.expectedHeadSha],
  input.expectedProfileVersion,input.expectedStopVersion]);
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
 return {action,operation,fingerprint:[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(''),
  profileVersion:input.expectedProfileVersion,stopVersion:input.expectedStopVersion};
}

export async function prepareMahoraga(request){
 try{
  const b=await bind(request);
  return {ok:true,grantRequest:{actor:'mcp:ultron',objectiveId:b.action.key,
   operation:b.operation,resource:'sha256:'+b.fingerprint,administrativeChange:false}};
 }catch{return held('invalid-request');}
}

const READ=`SELECT a.action_key,a.operation,a.request,a.state,m.grant_id,m.fingerprint
 FROM mahoraga_actions a LEFT JOIN mahoraga_mcp_authority m ON m.action_id=a.id
 WHERE a.action_key=$1`;
const ADMIT=`WITH policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.max_paid_cents,p.allowed_operations,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile p
 JOIN brain_runtime_control c ON c.id=1 WHERE p.id=1 FOR SHARE
), grant_row AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $4,$1,'mcp:ultron',$5,$6,$7,$8::timestamptz FROM policy
 WHERE owner='michaeljwilliams0123' AND preset IN ('build','release')
 AND version=$9 AND stop_version=$10 AND NOT paused AND max_paid_cents=0
 AND jsonb_exists(allowed_operations,$5::text) AND $8::timestamptz>clock_timestamp()
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), task AS (
 INSERT INTO brain_tasks(task_key,objective,status,max_attempts)
 SELECT 'mahoraga:' || $1,'mahoraga.' || $2,'external',1 FROM grant_row
 ON CONFLICT(task_key) DO NOTHING RETURNING id
), action AS (
 INSERT INTO mahoraga_actions(task_id,action_key,operation,request)
 SELECT id,$1,$2,$3::jsonb FROM task
 ON CONFLICT(action_key) DO NOTHING RETURNING id,task_id
), authority AS (
 INSERT INTO mahoraga_mcp_authority(action_id,grant_id,fingerprint,profile_version,stop_version)
 SELECT action.id,grant_row.grant_id,$11,$9,$10 FROM action CROSS JOIN grant_row
 RETURNING action_id
), grant_event AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'authority-grant-consumed',jsonb_build_object('grantId',grant_id,
 'operation',$5::text,'policySha',$7::text) FROM grant_row RETURNING id
), receipt AS (
 INSERT INTO brain_events(task_id,event_type,details)
 SELECT action.task_id,'mahoraga-admitted',jsonb_build_object('operation',$2::text,
 'grantId',$4::text) FROM action JOIN authority ON authority.action_id=action.id RETURNING id
) SELECT id FROM receipt`;

async function lookup(db,b,grantId){
 const result=await db.query(READ,[b.action.key]);
 if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('ambiguous-readback');
 const row=result.rows[0];
 if(!row)return null;
 if(row.operation!==b.action.operation||
  JSON.stringify(Object.keys(row.request||{}).sort().map(k=>[k,row.request[k]]))!==
  JSON.stringify(Object.keys(b.action.input).sort().map(k=>[k,b.action.input[k]]))||
  row.fingerprint!==b.fingerprint)return held('idempotency-conflict');
 if(row.grant_id!==grantId)return held('grant-conflict');
 return row;
}

export async function reconcileMahoraga({db,request,grantId}={}){
 let b;
 try{b=await bind(request);}catch{return held('invalid-request');}
 if(typeof db?.query!=='function'||typeof grantId!=='string'||
  !/^[A-Za-z0-9_.:-]{8,128}$/.test(grantId))return held('invalid-readback-request');
 try{
  const row=await lookup(db,b,grantId);
  if(!row)return uncertain('admission-not-observed');
  if(row.status==='held')return row;
  return await mahoragaActionStatus({db},b.action.key);
 }catch{return uncertain('readback-unavailable');}
}

export async function submitMahoraga({db,config,request,envelope}={}){
 let b;
 try{b=await bind(request);}catch{return held('invalid-request');}
 if(typeof db?.query!=='function'||typeof config?.get!=='function')
  return held('authority-or-ledger-unavailable');
 let key;
 try{
  const raw=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
  if(typeof raw!=='string'||raw.length<20||raw.length>4096)throw Error('missing-key');
  key=JSON.parse(raw);
 }catch{return held('adjudicator-unconfigured');}
 let grant;
 try{grant=await verifyDelegatedGrant({envelope,publicJwk:key,request:{
  actor:'mcp:ultron',objectiveId:b.action.key,operation:b.operation,
  resource:'sha256:'+b.fingerprint,administrativeChange:false
 }});}catch{return held('grant-invalid-or-expired');}
 let prior;
 try{prior=await lookup(db,b,grant.grantId);}catch{return uncertain('readback-unavailable');}
 if(prior?.status==='held')return prior;
 if(!prior){
  try{await db.query(ADMIT,[b.action.key,b.action.operation,JSON.stringify(b.action.input),
   grant.grantId,b.operation,grant.resource,grant.policySha,grant.expiresAt,
   b.profileVersion,b.stopVersion,b.fingerprint]);}catch{/* Read back the atomic admission. */}
  try{prior=await lookup(db,b,grant.grantId);}catch{return uncertain('readback-unavailable');}
  if(!prior)return uncertain('admission-or-authority-outcome-unresolved');
  if(prior.status==='held')return prior;
 }
 try{return await runMahoragaAction({db,config},b.action);}
 catch{return uncertain('dispatch-or-readback-unavailable');}
}
