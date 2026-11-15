import {createHash} from 'node:crypto';
import {verifyOwnerPasskeyAssertion} from 'lib/webauthn-owner.js';
import {validatePreparedCanary,operationDigest} from 'lib/github-pr-comment-canary.js';

// A narrow, alternative C04 approval primitive. There is no server-side
// owner signer: the registered authenticator signs one origin-bound challenge.
// The existing signed-envelope C04 path is left intact.
const OWNER='michaeljwilliams0123';
const REPO='michaeljwilliams0123/Ultron.MW';
const POLICY=createHash('sha256').update('ultron.c04.owner-signed-coordinator-pr-comment.v1').digest('hex');
const GRANT=/^passkey-[A-Za-z0-9-]{16,96}$/;
const B64=/^[A-Za-z0-9_-]{16,8192}$/;
const HELD=reason=>({ok:false,status:'held',reason});
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const resource=p=>'github:pr-comment:'+REPO+':'+p.pullRequest+':sha256:'+p.bodySha256;
const asIso=d=>d instanceof Date?d.toISOString():new Date(d).toISOString();
function prepared(value){try{return validatePreparedCanary(value);}catch{return null;}}
function validProof(p){return p&&typeof p==='object'&&!Array.isArray(p)&&
 Object.keys(p).sort().join(',')==='authenticatorData,clientDataJSON,credentialId,grantId,signature'&&
 GRANT.test(p.grantId||'')&&['authenticatorData','clientDataJSON','credentialId','signature']
 .every(k=>typeof p[k]==='string'&&B64.test(p[k]));}
const PREPARE=[
 "WITH policy AS MATERIALIZED (",
 " SELECT a.version AS profile_version,c.version AS stop_version",
 " FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1",
 " WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')",
 " AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0",
 " AND jsonb_exists(a.allowed_operations,'pr.comment') FOR SHARE",
 "), credential AS MATERIALIZED (",
 " SELECT credential_id FROM brain_owner_passkeys",
 " WHERE credential_id=$6 AND revoked_at IS NULL",
 "), saved AS (",
 " INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,",
 " actor,objective_id,operation,resource,policy_sha,administrative_change,",
 " profile_version,stop_version,expires_at)",
 " SELECT $1,$2,credential.credential_id,'mcp:ultron',$3,'pr.comment',$4,$5,FALSE,",
 " policy.profile_version,policy.stop_version,now()+interval '5 minutes'",
 " FROM policy CROSS JOIN credential RETURNING grant_id,expires_at",
 ") SELECT grant_id,expires_at AS \"expiresAt\" FROM saved"
].join('\n');
const READ=[
 'SELECT c.grant_id AS "grantId",c.challenge,c.credential_id AS "credentialId",',
 ' c.actor,c.objective_id AS "objectiveId",c.operation,c.resource,',
 ' c.policy_sha AS "policySha",c.administrative_change AS "administrativeChange",',
 ' c.profile_version AS "profileVersion",c.stop_version AS "stopVersion",',
 ' c.expires_at AS "expiresAt",c.created_at AS "createdAt",c.used_at AS "usedAt",',
 ' k.public_key_spki AS "publicKeySpki",k.sign_count AS "signCount",',
 ' k.revoked_at AS "revokedAt"',
 ' FROM brain_owner_passkey_challenges c',
 ' JOIN brain_owner_passkeys k ON k.credential_id=c.credential_id WHERE c.grant_id=$1'
].join('\n');
const CLAIM=[
 "WITH policy AS MATERIALIZED (",
 " SELECT 1 FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1",
 " WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')",
 " AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0",
 " AND jsonb_exists(a.allowed_operations,'pr.comment') FOR SHARE",
 "), existing AS MATERIALIZED (",
 " SELECT idempotency_key FROM github_pr_comment_executions WHERE idempotency_key=$1",
 " OR (repository='michaeljwilliams0123/Ultron.MW' AND target_number=$10 AND body_sha256=$11)",
 " UNION ALL SELECT idempotency_key FROM github_idempotent_executions WHERE idempotency_key=$1",
 "), claimed AS (",
 " UPDATE brain_owner_passkey_challenges ch SET used_at=now()",
 " WHERE ch.grant_id=$2 AND ch.credential_id=$3 AND ch.challenge=$4",
 " AND ch.actor='mcp:ultron' AND ch.objective_id=$1",
 " AND ch.operation='pr.comment' AND ch.resource=$5 AND ch.policy_sha=$6",
 " AND NOT ch.administrative_change AND ch.profile_version=$7 AND ch.stop_version=$8",
 " AND ch.used_at IS NULL AND ch.expires_at>clock_timestamp()",
 " AND EXISTS(SELECT 1 FROM policy) AND NOT EXISTS(SELECT 1 FROM existing)",
 " RETURNING ch.credential_id,ch.created_at,ch.expires_at",
 "), counter AS (",
 " UPDATE brain_owner_passkeys k SET sign_count=$9,last_used_at=now()",
 " FROM claimed WHERE k.credential_id=claimed.credential_id AND k.revoked_at IS NULL",
 " AND ((k.sign_count=0 AND $9=0) OR $9>k.sign_count)",
 " RETURNING k.credential_id",
 "), nonce AS (",
 " INSERT INTO brain_github_approval_nonces(nonce,operation,target_resource,approval_timestamp,expires_at)",
 " SELECT $2,'pr.comment',$5,claimed.created_at,claimed.expires_at",
 " FROM claimed WHERE EXISTS(SELECT 1 FROM counter)",
 " ON CONFLICT(nonce) DO NOTHING RETURNING nonce",
 "), admitted AS (",
 " INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)",
 " SELECT nonce.nonce,$1,'worker:coordinator','pr.comment',$5,$6,claimed.expires_at",
 " FROM nonce CROSS JOIN claimed ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id",
 "), execution AS (",
 " INSERT INTO github_pr_comment_executions(idempotency_key,operation_digest,repository,",
 " target_number,body_sha256,grant_id,persona_role,state)",
 " SELECT $1,$12,'michaeljwilliams0123/Ultron.MW',$10,$11,admitted.grant_id,'builder','reserved'",
 " FROM admitted RETURNING idempotency_key,state",
 "), receipt AS (",
 " INSERT INTO brain_events(event_type,details)",
 " SELECT 'github-pr-comment-reserved',jsonb_build_object('grantId',$2::text,",
 " 'idempotencyKey',$1::text,'operationDigest',$12::text,",
 " 'pullRequest',$10::bigint,'bodySha256',$11::text,'authority','owner-webauthn')",
 " FROM execution RETURNING id",
 ") SELECT 'reserved' AS outcome FROM execution JOIN receipt ON true",
 " UNION ALL SELECT 'existing' AS outcome FROM existing",
 " WHERE NOT EXISTS(SELECT 1 FROM execution)",
 " UNION ALL SELECT 'denied' AS outcome",
 " WHERE NOT EXISTS(SELECT 1 FROM execution) AND NOT EXISTS(SELECT 1 FROM existing)"
].join('\n');
export async function beginC04PasskeyChallenge({
 db,prepared:raw,credentialId,expectedProfileVersion,expectedStopVersion
}={}){
 const p=prepared(raw);
 if(!p||typeof db?.query!=='function'||typeof credentialId!=='string'||
  !B64.test(credentialId)||credentialId.length>1024||
  !Number.isSafeInteger(expectedProfileVersion)||expectedProfileVersion<1||
  !Number.isSafeInteger(expectedStopVersion)||expectedStopVersion<1)
  return HELD('invalid-passkey-preparation');
 const grantId='passkey-'+crypto.randomUUID();
 const challenge=b64(crypto.getRandomValues(new Uint8Array(32)));
 try{
  const result=await db.query(PREPARE,[grantId,challenge,p.idempotencyKey,
   resource(p),POLICY,credentialId,expectedProfileVersion,expectedStopVersion]);
  if(result.rows?.length!==1)return HELD('passkey-owner-profile-or-credential-denied');
  return {ok:true,status:'prepared',grantId,challenge,credentialId,
   rpId:'ultron-mw-cloud.hatchable.site',expiresAt:asIso(result.rows[0].expiresAt),
   timeoutMs:120000};
 }catch{return HELD('passkey-challenge-unavailable');}
}
export async function verifyAndReserveC04Passkey({db,prepared:raw,proof}={}){
 const p=prepared(raw);
 if(!p||!validProof(proof)||typeof db?.query!=='function')
  return HELD('invalid-passkey-proof');
 let row;
 try{const result=await db.query(READ,[proof.grantId]);
  row=result.rows?.length===1?result.rows[0]:null;
 }catch{return HELD('passkey-readback-unavailable');}
 if(!row||row.usedAt||row.revokedAt||Date.parse(row.expiresAt)<=Date.now()||
  row.credentialId!==proof.credentialId||
  row.actor!=='worker:coordinator'||row.objectiveId!==p.idempotencyKey||
  row.operation!=='pr.comment'||row.resource!==resource(p)||
  row.policySha!==POLICY||row.administrativeChange!==false||
  !Number.isSafeInteger(row.profileVersion)||!Number.isSafeInteger(row.stopVersion))
  return HELD('passkey-challenge-stale-or-mismatched');
 let signature;
 try{signature=await verifyOwnerPasskeyAssertion({
  credentialId:proof.credentialId,expectedCredentialId:row.credentialId,
  publicKeySpki:row.publicKeySpki,challenge:row.challenge,
  authenticatorData:proof.authenticatorData,
  clientDataJSON:proof.clientDataJSON,signature:proof.signature
 });}catch{return HELD('passkey-signature-invalid');}
 const signCount=signature.signCount;
 if((signCount===0&&Number(row.signCount)!==0)||
  (signCount!==0&&signCount<=Number(row.signCount)))
  return HELD('passkey-counter-replayed');
 const digest=operationDigest(p,proof.grantId);
 try{
  const result=await db.query(CLAIM,[p.idempotencyKey,proof.grantId,proof.credentialId,
   row.challenge,resource(p),POLICY,row.profileVersion,row.stopVersion,signCount,
   p.pullRequest,p.bodySha256,digest]);
  if(result.rows?.length!==1)return HELD('passkey-reservation-unavailable');
  const outcome=result.rows[0].outcome;
  if(outcome!=='reserved')return HELD(outcome==='existing'
   ?'execution-already-reserved':'authority-or-passkey-replay-denied');
  return {ok:true,status:'reserved',idempotencyKey:p.idempotencyKey,
   grantId:proof.grantId,operationDigest:digest};
 }catch{return HELD('passkey-reservation-unavailable');}
}
