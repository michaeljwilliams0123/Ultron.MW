import {verifyDelegatedGrant} from 'lib/security-adjudicator.js';

const KEY=/^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const OPERATIONS=new Set(['graph.workbook.cell.write','github.issue.write',
 'gitlab.branch.create']);
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
export function dataObject(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-request');
 const result=Object.create(null);
 for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){
  if(!d.enumerable||!Object.hasOwn(d,'value'))throw Error('invalid-request');
  result[key]=d.value;
 }
 return result;
}
export async function hash(value){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value))));
 return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function providerBinding({key,operation,target,payload,expectedProfileVersion,expectedStopVersion}){
 if(typeof key!=='string'||!KEY.test(key)||!OPERATIONS.has(operation)||
  !Array.isArray(target)||!Array.isArray(payload)||
  !Number.isSafeInteger(expectedProfileVersion)||expectedProfileVersion<1||
  !Number.isSafeInteger(expectedStopVersion)||expectedStopVersion<1)
  throw Error('invalid-request');
 const resourceKey=await hash(['ultron.provider.target.v1',operation,...target]);
 const fingerprint=await hash(['ultron.provider.write.v1',key,operation,target,payload,
  expectedProfileVersion,expectedStopVersion]);
 return Object.freeze({key,operation,resourceKey,fingerprint,expectedProfileVersion,expectedStopVersion});
}
export function grantRequest(binding){
 return {actor:'mcp:ultron',objectiveId:binding.key,operation:binding.operation,
  resource:'sha256:'+binding.fingerprint,administrativeChange:false};
}
const READ=`SELECT action_key,operation,fingerprint,resource_key,grant_id,status,evidence
 FROM brain_mcp_provider_writes WHERE action_key=$1`;
const CLAIM=`WITH policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.max_paid_cents,p.allowed_operations,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile p
 JOIN brain_runtime_control c ON c.id=1 WHERE p.id=1 FOR SHARE
), grant_row AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $4,$1,'mcp:ultron',$2,$5,$6,$7::timestamptz FROM policy
 WHERE owner='michaeljwilliams0123' AND preset IN ('build','release')
 AND version=$8 AND stop_version=$9 AND NOT paused AND max_paid_cents=0
 AND jsonb_exists(allowed_operations,$2::text) AND $7::timestamptz>clock_timestamp()
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), claimed AS (
 INSERT INTO brain_mcp_provider_writes(action_key,operation,fingerprint,resource_key,grant_id,
 profile_version,stop_version,status)
 SELECT $1,$2,$3,$10,grant_id,$8,$9,'reconcile-required' FROM grant_row
 ON CONFLICT DO NOTHING RETURNING action_key,grant_id
), grant_event AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'authority-grant-consumed',jsonb_build_object('grantId',grant_id,
 'operation',$2::text,'policySha',$6::text) FROM grant_row RETURNING id
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'mcp-provider-dispatch-claimed',jsonb_build_object('action_key',action_key,
 'operation',$2::text,'grant_id',grant_id) FROM claimed RETURNING id
) SELECT id FROM receipt`;
const CHECK=`SELECT EXISTS (
 SELECT 1 FROM brain_mcp_provider_writes w
 JOIN brain_authority_grants g ON g.grant_id=w.grant_id
 JOIN brain_owner_autonomy_profile p ON p.id=1
 JOIN brain_runtime_control c ON c.id=1
 WHERE w.action_key=$1 AND w.fingerprint=$2 AND w.grant_id=$3
 AND w.status='reconcile-required' AND g.expires_at>clock_timestamp()
 AND p.owner='michaeljwilliams0123' AND p.preset IN ('build','release')
 AND p.version=w.profile_version AND p.max_paid_cents=0
 AND jsonb_exists(p.allowed_operations,w.operation)
 AND NOT c.paused AND c.version=w.stop_version
) AS admitted`;
const OBSERVE=`WITH moved AS (
 UPDATE brain_mcp_provider_writes SET status='observed',evidence=$4::jsonb,updated_at=now()
 WHERE action_key=$1 AND fingerprint=$2 AND grant_id=$3 AND status='reconcile-required'
 RETURNING action_key,operation,grant_id
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'mcp-provider-write-observed',jsonb_build_object('action_key',action_key,
 'operation',operation,'grant_id',grant_id,'evidence',$4::jsonb) FROM moved RETURNING id
) SELECT id FROM receipt`;

async function read(db,b,grantId){
 const response=await db.query(READ,[b.key]);
 if(!Array.isArray(response?.rows)||response.rows.length>1)throw Error('invalid-readback');
 const row=response.rows[0];
 if(!row)return null;
 if(row.operation!==b.operation||row.fingerprint!==b.fingerprint||row.resource_key!==b.resourceKey)
  return held('idempotency-conflict');
 if(row.grant_id!==grantId)return held('grant-conflict');
 if(row.status==='reconcile-required')return uncertain('provider-outcome-unresolved');
 if(row.status!=='observed'||!row.evidence||typeof row.evidence!=='object')
  return uncertain('invalid-receipt');
 return {ok:true,status:'observed',key:b.key,evidence:row.evidence};
}
export async function reconcileProvider({db,binding,grantId}){
 if(typeof db?.query!=='function'||typeof grantId!=='string'||!GRANT.test(grantId))
  return held('invalid-readback-request');
 try{return await read(db,binding,grantId)??uncertain('dispatch-not-observed');}
 catch{return uncertain('readback-unavailable');}
}
export async function authorizeProvider({db,config,binding,envelope}){
 if(typeof db?.query!=='function'||typeof config?.get!=='function')
  return {error:held('authority-or-ledger-unavailable')};
 let publicJwk,grant;
 try{
  const raw=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
  if(typeof raw!=='string'||raw.length<20||raw.length>4096)throw Error('invalid-key');
  publicJwk=JSON.parse(raw);
 }catch{return {error:held('adjudicator-unconfigured')};}
 try{grant=await verifyDelegatedGrant({envelope,publicJwk,request:grantRequest(binding)});}
 catch{return {error:held('grant-invalid-or-expired')};}
 let prior;
 try{prior=await read(db,binding,grant.grantId);}catch{return {error:uncertain('readback-unavailable')};}
 if(prior)return {error:prior};
 let claimed=false;
 return {
  async claim(){
   if(claimed)return false;
   let result;
   try{result=await db.query(CLAIM,[binding.key,binding.operation,binding.fingerprint,
    grant.grantId,grant.resource,grant.policySha,grant.expiresAt,
    binding.expectedProfileVersion,binding.expectedStopVersion,binding.resourceKey]);}
   catch{throw Error('claim-outcome-unresolved');}
   if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('claim-outcome-unresolved');
   claimed=result.rows.length===1;
   return claimed;
  },
  async canDispatch(){
   if(!claimed)return false;
   const result=await db.query(CHECK,[binding.key,binding.fingerprint,grant.grantId]);
   return result?.rows?.length===1&&result.rows[0].admitted===true;
  },
  async observe(evidence){
   if(!claimed||!evidence||evidence.providerAcknowledged!==true||evidence.readbackMatches!==true)
    return false;
   const safe={providerAcknowledged:true,readbackMatches:true,
    ...(Number.isSafeInteger(evidence.issueNumber)?{issueNumber:evidence.issueNumber}:{}),
    ...(['open','closed'].includes(evidence.state)?{state:evidence.state}:{})};
   try{await db.query(OBSERVE,[binding.key,binding.fingerprint,grant.grantId,JSON.stringify(safe)]);}
   catch{/* Observation commit may have succeeded. */}
   const result=await read(db,binding,grant.grantId);
   return result?.ok===true&&Object.keys(result.evidence).length===Object.keys(safe).length&&
    Object.keys(safe).every(key=>result.evidence[key]===safe[key]);
  },
  async result(){return reconcileProvider({db,binding,grantId:grant.grantId});}
 };
}

function reconciledEvidence(binding,evidence){
 if(evidence?.readbackMatches!==true ||
  typeof evidence.providerAcknowledged!=='boolean')
  throw Error('invalid-reconciliation-evidence');
 if(binding.operation==='gitlab.branch.create'){
  if(evidence.branchName!=='ultron/task-'+binding.key ||
   !/^[a-f0-9]{40}$/.test(evidence.sourceSha||'')||
   evidence.projectId!==87884831)
   throw Error('invalid-reconciliation-evidence');
  return {providerAcknowledged:evidence.providerAcknowledged,readbackMatches:true,
   projectId:87884831,branchName:evidence.branchName,sourceSha:evidence.sourceSha};
 }
 throw Error('unsupported-reconciliation-evidence');
}
// This only promotes an already-claimed, matching write after independent
// provider readback. It never grants authority or sends another provider POST.
export async function reconcileProviderObserved({db,binding,grantId,evidence}={}){
 if(typeof db?.query!=='function'||typeof grantId!=='string'||!GRANT.test(grantId))
  return held('invalid-readback-request');
 let safe;
 try{safe=reconciledEvidence(binding,evidence);}
 catch{return held('invalid-reconciliation-evidence');}
 let prior;
 try{prior=await read(db,binding,grantId);}
 catch{return uncertain('readback-unavailable');}
 if(!prior)return uncertain('dispatch-not-observed');
 if(prior.ok===true||prior.status==='held')return prior;
 try{await db.query(OBSERVE,[binding.key,binding.fingerprint,grantId,JSON.stringify(safe)]);}
 catch{/* The update may have committed. Always use independent ledger readback. */}
 return reconcileProvider({db,binding,grantId});
}
