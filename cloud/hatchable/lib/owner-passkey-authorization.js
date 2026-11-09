import {verifyOwnerPasskeyAssertion} from 'lib/webauthn-owner.js';
import {providerDispatchAllowed} from 'lib/mcp-provider-write.js';

const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
const B64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const ID=/^passkey-[A-Za-z0-9-]{16,96}$/;
const requestValid=g=>g&&g.actor==='mcp:ultron'&&g.operation==='gitlab.branch.create'&&
 g.administrativeChange===false&&typeof g.objectiveId==='string'&&
 /^sha256:[a-f0-9]{64}$/.test(g.resource)&&/^[a-f0-9]{64}$/.test(g.policySha)&&
 Number.isSafeInteger(g.profileVersion)&&g.profileVersion>0&&
 Number.isSafeInteger(g.stopVersion)&&g.stopVersion>0;

const BEGIN=`WITH current_policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.allowed_operations,p.max_paid_cents,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile p
 JOIN brain_runtime_control c ON c.id=1 WHERE p.id=1 FOR SHARE
), eligible AS (
 SELECT k.credential_id FROM brain_owner_passkeys k CROSS JOIN current_policy p
 WHERE k.credential_id=$2 AND k.revoked_at IS NULL
 AND p.owner='michaeljwilliams0123' AND p.preset IN ('build','release')
 AND p.version=$7 AND p.stop_version=$8 AND NOT p.paused
 AND p.max_paid_cents=0 AND jsonb_exists(p.allowed_operations,'gitlab.branch.create')
), created AS (
 INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,
 actor,objective_id,operation,resource,policy_sha,administrative_change,
 profile_version,stop_version,expires_at)
 SELECT $1,$3,credential_id,'mcp:ultron',$4,'gitlab.branch.create',$5,$6,FALSE,
 $7,$8,now()+interval '5 minutes' FROM eligible
 RETURNING grant_id
) SELECT grant_id FROM created`;
const READ=`SELECT c.grant_id AS "grantId",c.challenge,c.credential_id AS "credentialId",
 c.objective_id AS "objectiveId",c.resource,c.policy_sha AS "policySha",
 c.profile_version AS "profileVersion",c.stop_version AS "stopVersion",
 c.expires_at AS "expiresAt",c.used_at AS "usedAt",
 k.public_key_spki AS "publicKeySpki",k.sign_count AS "signCount",
 k.revoked_at AS "revokedAt" FROM brain_owner_passkey_challenges c
 JOIN brain_owner_passkeys k ON k.credential_id=c.credential_id
 WHERE c.grant_id=$1`;

const CLAIM=`WITH policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.max_paid_cents,p.allowed_operations,
 c.paused,c.version AS stop_version FROM brain_owner_autonomy_profile p
 JOIN brain_runtime_control c ON c.id=1 WHERE p.id=1 FOR SHARE
), consumed AS (
 UPDATE brain_owner_passkey_challenges ch SET used_at=now()
 FROM policy,brain_owner_passkeys cred
 WHERE ch.grant_id=$4 AND ch.credential_id=$11 AND cred.credential_id=$11
 AND cred.revoked_at IS NULL AND ch.used_at IS NULL
 AND ch.expires_at>clock_timestamp() AND ch.expires_at=$7::timestamptz
 AND ch.actor='mcp:ultron' AND ch.objective_id=$1 AND ch.operation=$2
 AND ch.resource=$5 AND ch.policy_sha=$6 AND NOT ch.administrative_change
 AND ch.profile_version=$8 AND ch.stop_version=$9
 AND policy.owner='michaeljwilliams0123' AND policy.preset IN ('build','release')
 AND policy.version=$8 AND policy.stop_version=$9 AND NOT policy.paused
 AND policy.max_paid_cents=0 AND jsonb_exists(policy.allowed_operations,$2::text)
 AND ((cred.sign_count=0 AND $12=0) OR $12>cred.sign_count)
 RETURNING ch.credential_id
), counter AS (
 UPDATE brain_owner_passkeys cred SET sign_count=$12,last_used_at=now()
 FROM consumed WHERE cred.credential_id=consumed.credential_id
 AND cred.revoked_at IS NULL
 AND ((cred.sign_count=0 AND $12=0) OR $12>cred.sign_count)
 RETURNING cred.credential_id
), grant_row AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $4,$1,'mcp:ultron',$2,$5,$6,$7::timestamptz FROM counter
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), claimed AS (
 INSERT INTO brain_mcp_provider_writes(action_key,operation,fingerprint,resource_key,grant_id,
 profile_version,stop_version,status)
 SELECT $1,$2,$3,$10,grant_id,$8,$9,'reconcile-required' FROM grant_row
 ON CONFLICT DO NOTHING RETURNING action_key,grant_id
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'passkey-provider-dispatch-claimed',jsonb_build_object('action_key',action_key,
 'operation',$2::text,'grant_id',grant_id) FROM claimed RETURNING id
) SELECT id FROM receipt`;
export async function startOwnerPasskeyChallenge({db,grantRequest,credentialId}={}){
 if(!requestValid(grantRequest)||typeof credentialId!=='string'||
  credentialId.length<16||credentialId.length>1024||
  typeof db?.query!=='function')return held('invalid-passkey-preparation');
 const grantId='passkey-'+crypto.randomUUID();
 const challenge=B64(crypto.getRandomValues(new Uint8Array(32)));
 try{
  const r=await db.query(BEGIN,[grantId,credentialId,challenge,grantRequest.objectiveId,
   grantRequest.resource,grantRequest.policySha,grantRequest.profileVersion,
   grantRequest.stopVersion]);
  if(r?.rows?.length!==1)return held('passkey-profile-or-credential-denied');
 }catch{return uncertain('passkey-challenge-not-confirmed');}
 return {ok:true,status:'prepared',grantId,challenge,credentialId,
  rpId:'ultron-mw-cloud.hatchable.site',timeoutMs:300000};
}
export async function authorizeOwnerPasskeyProvider({db,binding,proof}={}){
 if(typeof db?.query!=='function'||!binding||!proof||!ID.test(proof.grantId||'')||
  typeof proof.credentialId!=='string')return {error:held('invalid-passkey-proof')};
 const g={actor:'mcp:ultron',objectiveId:binding.key,operation:binding.operation,
  resource:'sha256:'+binding.fingerprint,policySha:binding.policySha,
  profileVersion:binding.expectedProfileVersion,
  stopVersion:binding.expectedStopVersion,administrativeChange:false};
 if(!requestValid(g))return {error:held('invalid-provider-binding')};
 let row;
 try{
  const r=await db.query(READ,[proof.grantId]);
  row=r?.rows?.length===1?r.rows[0]:null;
 }catch{return {error:uncertain('passkey-readback-unavailable')}};
 if(!row||row.usedAt||row.revokedAt||Date.parse(row.expiresAt)<=Date.now()||
  row.credentialId!==proof.credentialId||row.objectiveId!==g.objectiveId||
  row.resource!==g.resource||row.policySha!==g.policySha||
  row.profileVersion!==g.profileVersion||row.stopVersion!==g.stopVersion)
  return {error:held('passkey-challenge-stale-or-mismatched')};
 let verified;
 try{verified=await verifyOwnerPasskeyAssertion({
  credentialId:proof.credentialId,expectedCredentialId:row.credentialId,
  publicKeySpki:row.publicKeySpki,challenge:row.challenge,
  authenticatorData:proof.authenticatorData,clientDataJSON:proof.clientDataJSON,
  signature:proof.signature
 });}
 catch{return {error:held('passkey-signature-invalid')}};
 if(verified.signCount!==0&&verified.signCount<=Number(row.signCount))
  return {error:held('passkey-counter-replayed')};
 if(verified.signCount===0&&Number(row.signCount)!==0)
  return {error:held('passkey-counter-replayed')};
 let claimed=false;
 return {
  grantId:proof.grantId,
  async claim(){
   if(claimed)return false;
   let result;
   try{result=await db.query(CLAIM,[binding.key,binding.operation,binding.fingerprint,
    proof.grantId,g.resource,g.policySha,row.expiresAt,
    binding.expectedProfileVersion,binding.expectedStopVersion,
    binding.resourceKey,proof.credentialId,verified.signCount]);}
   catch{throw Error('passkey-claim-unresolved')};
   if(!Array.isArray(result?.rows)||result.rows.length>1)
    throw Error('passkey-claim-unresolved');
   claimed=result.rows.length===1;
   return claimed;
  },
  async canDispatch(){
   return claimed&&await providerDispatchAllowed({db,binding,grantId:proof.grantId});
  }
 };
}
