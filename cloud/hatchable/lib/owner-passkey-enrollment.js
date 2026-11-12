import {verifyDelegatedGrant} from 'lib/security-adjudicator.js';
import {verifyOwnerPasskeyRegistration} from 'lib/webauthn-owner.js';

const OWNER='michaeljwilliams0123';
const KEY=/^[a-z0-9-]{8,48}$/;
const HELD=reason=>({ok:false,status:'held',reason});
const UNCERTAIN=reason=>({ok:false,status:'reconcile-required',reason});
// Owner-only, allowlisted diagnostic reasons. Never return raw crypto exceptions,
// signed envelopes, private keys, PEM, or signer identity internals.
const GRANT_REASONS=new Set([
 'invalid-grant-payload','invalid-grant-signature',
 'invalid-grant-claims','invalid-grant-time','invalid-grant-versions',
 'unsupported-grant-operation','invalid-grant-policy',
 'invalid-grant-pr-comment-scope','grant-ttl-exceeded','grant-expired',
 'grant-not-yet-valid','grant-scope-mismatch','administrative-grant-required',
 'invalid-adjudicator-public-key','trusted-adjudicator-key-unavailable',
 'grant-signature-provider-unavailable','grant-signature-provider-error',
 'grant-signature-provider-update-error','grant-signature-provider-verify-error'
]);
const diagnosticReason=error=>GRANT_REASONS.has(error?.message)?
 error.message:'verification-failed';
const TEXT=new TextEncoder();
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function digest(data){
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',TEXT.encode(JSON.stringify(data))));
 return [...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function exactly(obj,keys){
 return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join(',')===[...keys].sort().join(',');
}
const GET_ENROLL=`SELECT enrollment_key AS "key",label,challenge,fingerprint,policy_sha AS "policySha",
 profile_version AS "profileVersion",stop_version AS "stopVersion",
 expires_at AS "expiresAt",used_at AS "usedAt",credential_id AS "credentialId"
 FROM brain_owner_passkey_enrollments WHERE enrollment_key=$1`;
const PREPARE=`WITH policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.max_paid_cents,p.allowed_operations,c.paused,c.version AS stop_version
 FROM brain_owner_autonomy_profile p JOIN brain_runtime_control c ON c.id=1
 WHERE p.id=1 FOR SHARE
), prepared AS (
 INSERT INTO brain_owner_passkey_enrollments(enrollment_key,label,challenge,
 fingerprint,policy_sha,profile_version,stop_version,expires_at)
 SELECT $1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes' FROM policy
 WHERE owner='michaeljwilliams0123' AND preset IN ('build','release')
 AND NOT paused AND max_paid_cents=0 AND version=$6 AND stop_version=$7
 AND jsonb_exists(allowed_operations,'owner.passkey.enroll')
 ON CONFLICT(enrollment_key) DO NOTHING RETURNING enrollment_key
) SELECT enrollment_key FROM prepared`;
const COMMIT=`WITH policy AS MATERIALIZED (
 SELECT p.owner,p.preset,p.version,p.max_paid_cents,p.allowed_operations,c.paused,c.version AS stop_version
 FROM brain_owner_autonomy_profile p JOIN brain_runtime_control c ON c.id=1
 WHERE p.id=1 FOR SHARE
), claimed AS (
 UPDATE brain_owner_passkey_enrollments e
 SET used_at=now(),credential_id=$10
 FROM policy
 WHERE e.enrollment_key=$1 AND e.fingerprint=$2 AND e.challenge=$3
 AND e.policy_sha=$5 AND e.profile_version=$8 AND e.stop_version=$9
 AND e.used_at IS NULL AND e.expires_at>clock_timestamp()
 AND policy.owner='michaeljwilliams0123' AND policy.preset IN ('build','release')
 AND policy.version=$8 AND policy.stop_version=$9 AND NOT policy.paused
 AND policy.max_paid_cents=0
 AND jsonb_exists(policy.allowed_operations,'owner.passkey.enroll')
 RETURNING e.enrollment_key,e.label,e.fingerprint
), accepted AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $4,$1,'mcp:ultron','owner.passkey.enroll',$6,$5,$7::timestamptz
 FROM claimed WHERE $7::timestamptz>clock_timestamp()
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), enrolled AS (
 INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,sign_count,
 enrollment_key,enrollment_fingerprint,enrolled_grant_id)
 SELECT $10,$11,claimed.label,$12,claimed.enrollment_key,claimed.fingerprint,accepted.grant_id
 FROM claimed JOIN accepted ON true
 ON CONFLICT DO NOTHING RETURNING credential_id
), receipt AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'owner-passkey-enrolled',jsonb_build_object('credentialId',credential_id,'operation','owner.passkey.enroll')
 FROM enrolled RETURNING id
) SELECT enrolled.credential_id AS "credentialId",receipt.id AS "receiptId"
 FROM enrolled JOIN receipt ON true`;

async function enrollment(db,key){
 const r=await db.query(GET_ENROLL,[key]);
 if(!Array.isArray(r?.rows)||r.rows.length>1)throw Error('enrollment-readback-unavailable');
 return r.rows[0]??null;
}
function grantRequest(row){
 return {actor:'mcp:ultron',objectiveId:row.key,operation:'owner.passkey.enroll',
  resource:'sha256:'+row.fingerprint,administrativeChange:false,
  profileVersion:row.profileVersion,stopVersion:row.stopVersion,
  policySha:row.policySha};
}
export async function prepareOwnerPasskey({db,request}={}){
 if(!exactly(request,['key','label','expectedProfileVersion','expectedStopVersion'])||
  typeof request.key!=='string'||!KEY.test(request.key)||
  typeof request.label!=='string'||request.label.trim().length<1||
  request.label.length>64||!Number.isSafeInteger(request.expectedProfileVersion)||
  request.expectedProfileVersion<1||!Number.isSafeInteger(request.expectedStopVersion)||
  request.expectedStopVersion<1||typeof db?.query!=='function')
  return HELD('invalid-enrollment-request');
 const key=request.key,label=request.label.trim();
 let row;
 try{
  row=await enrollment(db,key);
  if(!row){
   const bytes=crypto.getRandomValues(new Uint8Array(32));
   const challenge=base64url(bytes);
   const fingerprint=await digest(['ultron.owner.passkey.enroll.v1',key,label,challenge,
    request.expectedProfileVersion,request.expectedStopVersion]);
   const policySha=await digest(['ultron.owner.passkey.enroll.policy.v1',fingerprint,0]);
   await db.query(PREPARE,[key,label,challenge,fingerprint,policySha,
    request.expectedProfileVersion,request.expectedStopVersion]);
   row=await enrollment(db,key);
  }
 }catch{return UNCERTAIN('enrollment-preparation-unavailable');}
 if(!row||row.label!==label||row.profileVersion!==request.expectedProfileVersion||
  row.stopVersion!==request.expectedStopVersion||row.usedAt||
  Date.parse(row.expiresAt)<=Date.now())
  return HELD('enrollment-key-or-version-denied');
 return {ok:true,status:'prepared',key,grantRequest:grantRequest(row),
  challenge:row.challenge,rpId:'ultron-mw-cloud.hatchable.site',
  expiresAt:row.expiresAt,
  userId:base64url(crypto.getRandomValues(new Uint8Array(16)))};
}
export async function finishOwnerPasskey({db,config,key,envelope,attestation}={}){
 if(typeof key!=='string'||!KEY.test(key)||typeof db?.query!=='function'||
  typeof config?.get!=='function'||!exactly(attestation,
   ['credentialId','clientDataJSON','attestationObject']))
  return HELD('invalid-enrollment-request');
 let row;try{row=await enrollment(db,key);}
 catch{return UNCERTAIN('enrollment-readback-unavailable');}
 if(!row||row.usedAt||Date.parse(row.expiresAt)<=Date.now())
  return HELD('enrollment-expired-or-used');
 // Distinguish the signer grant from browser attestation; neither stage can
 // persist owner credentials until both independently succeed.
 let grant;
 try{
  const pinned=JSON.parse(await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK'));
  grant=await verifyDelegatedGrant({envelope,publicJwk:pinned,request:grantRequest(row)});
 }catch(error){return HELD('enrollment-owner-grant-'+diagnosticReason(error));}
 if(grant.profileVersion!==row.profileVersion||grant.stopVersion!==row.stopVersion||
    grant.policySha!==row.policySha)
  return HELD('enrollment-owner-grant-binding-mismatch');
 let credential;
 try{
  credential=await verifyOwnerPasskeyRegistration({...attestation,challenge:row.challenge});
 }catch(error){
  // Expose only internal enumerated verifier categories to this owner-only
  // endpoint; never send authenticator data, signatures, or raw error details.
  const reason=typeof error?.message==='string'?error.message:'';
  const detail=/^passkey-[a-z0-9-]{3,60}$/.test(reason)?
   reason.slice('passkey-'.length):'verification-failed';
  return HELD('enrollment-webauthn-'+detail);
 }
 try{
  await db.query(COMMIT,[row.key,row.fingerprint,row.challenge,grant.grantId,
   grant.policySha,grant.resource,grant.expiresAt,row.profileVersion,row.stopVersion,
   credential.credentialId,credential.publicKeySpki,credential.signCount]);
 }catch{/* Atomic SQL may have committed even when reply was lost. */ }
 try{
  const r=await db.query(`SELECT p.credential_id AS "credentialId",p.label,p.enrolled_grant_id AS "grantId",
   e.fingerprint AS "fingerprint"
   FROM brain_owner_passkeys p JOIN brain_owner_passkey_enrollments e
   ON e.enrollment_key=p.enrollment_key WHERE p.enrollment_key=$1`,[key]);
  const x=r?.rows?.[0];
  if(x?.credentialId===credential.credentialId&&x.grantId===grant.grantId&&
   x.fingerprint===row.fingerprint)return {ok:true,status:'enrolled',
    credentialId:x.credentialId,label:x.label};
 }catch{}
 return UNCERTAIN('enrollment-commit-unresolved');
}
// Only expired, unused enrollment requests can be diagnosed.
// This function performs no admission, credential creation, or SQL mutation.
export async function diagnoseExpiredOwnerGrant({db,config,key,envelope}={}){
 if(typeof key!=='string'||!KEY.test(key)||typeof db?.query!=='function'||
  typeof config?.get!=='function'||!exactly(envelope,['payload','signature']))
  return HELD('invalid-grant-diagnostic');
 let row;
 try{row=await enrollment(db,key);}catch{return UNCERTAIN('diagnostic-read-unavailable');}
 if(!row||row.usedAt||Date.parse(row.expiresAt)>Date.now())
  return HELD('diagnostic-expired-only');
 let pinned;
 try{pinned=JSON.parse(await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK'));}
 catch{return UNCERTAIN('diagnostic-verifier-unavailable');}
 try{
  await verifyDelegatedGrant({envelope,publicJwk:pinned,request:grantRequest(row)});
  return {ok:true,status:'diagnosed',reason:'signature-valid'};
 }catch(error){
  return {ok:true,status:'diagnosed',reason:diagnosticReason(error)};
 }
}

export async function listOwnerPasskeys({db}={}){
 if(typeof db?.query!=='function')throw Error('passkey-db-unavailable');
 const r=await db.query(`SELECT credential_id AS "credentialId",label,created_at AS "createdAt",
  last_used_at AS "lastUsedAt" FROM brain_owner_passkeys
  WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 12`);
 if(!Array.isArray(r?.rows))throw Error('passkey-db-unavailable');
 return r.rows;
}
