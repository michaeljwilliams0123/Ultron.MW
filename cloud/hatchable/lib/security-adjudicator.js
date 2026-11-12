import {createVerify} from 'node:crypto';
// Delegated owner-authority verifier. The sole repository owner controls the
// signing key; workers hold ONLY the pinned public verification key.
// This module cannot mint credentials, grant itself privileges, or change policy.
const VERIFIED=new WeakSet();
const PR_COMMENT_POLICY_SHA='742eeeaa209cebeb376c23778918082ebc07efa1b25f9ecb2ad77a3acf82a7ac';
const OPERATIONS=new Set([
 'repo.inspect','repo.issue.create','repo.verify.dispatch','repo.pr.review',
 'repo.pr.squash','repo.branch.update','cloud.deploy','permissions.change',
 'pr.comment',
 'webhook.configure','cloud.note.create','mcp.queue.submit','mcp.task.control',
 'graph.workbook.cell.write','github.issue.write','gitlab.branch.create',
 'owner.passkey.enroll'
]);
const GRANT_SCHEMA='ultron.security-grant.v1';
const ISSUER='ultron-owner-authority';
const OWNER='michaeljwilliams0123';
const AUDIENCE='ultron-cloud-brain';
const SHA256=/^[a-f0-9]{64}$/;
// C04: one canonical PR number and the exact SHA-256 comment-body digest.
const PR_COMMENT_RESOURCE=/^github:pr-comment:michaeljwilliams0123\/Ultron\.MW:[1-9][0-9]{0,8}:sha256:[a-f0-9]{64}$/;
const GRANT_ID=/^[A-Za-z0-9_.:-]{8,128}$/;
const MAX_TTL_MS=15*60*1000;
function refuse(message){throw Error(message);}
function parseTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
  refuse('invalid-grant-time');
 const result=Date.parse(value);
 if(!Number.isFinite(result)||
  new Date(result).toISOString().slice(0,19)!==value.slice(0,19))
  refuse('invalid-grant-time');
 return result;
}
function decodeSignature(encoded){
 if(typeof encoded!=='string'||!(/^[a-zA-Z0-9_-]{86}$/).test(encoded))
  refuse('invalid-grant-signature');
 let raw;
 try{raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'==');}
 catch{refuse('invalid-grant-signature');}
 if(raw.length!==64)refuse('invalid-grant-signature');
 return Uint8Array.from(raw,x=>x.charCodeAt(0));
}
function keyFromJwk(jwk){
 const dec=v=>{
  if(typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v))refuse('invalid-adjudicator-public-key');
  return Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
 };
 const x=dec(jwk.x),y=dec(jwk.y);
 const prefix='3059301306072a8648ce3d020106082a8648ce3d03010703420004';
 const raw=new Uint8Array(91);
 raw.set(Uint8Array.from(prefix.match(/../g).map(h=>parseInt(h,16))));
 raw.set(x,27);raw.set(y,59);
 const base64=btoa(String.fromCharCode(...raw));
 return '-----BEGIN PUBLIC KEY-----\n'+base64.match(/.{1,64}/g).join('\n')+
  '\n-----END PUBLIC KEY-----';
}
function rawEcdsaToDer(raw){
 const component=bytes=>{
  let i=0;while(i<bytes.length-1&&bytes[i]===0)i++;
  const value=bytes.slice(i);
  return value[0]&0x80?Uint8Array.from([0,...value]):value;
 };
 const r=component(raw.slice(0,32)),s=component(raw.slice(32));
 return Uint8Array.from([0x30,4+r.length+s.length,2,r.length,...r,2,s.length,...s]);
}
// Hatchable's host-bridged createVerify only needs update() and verify().
// Do not depend on Node stream-only end(): the bridge need not implement it.
// Verification still consumes the exact signed payload and DER-encoded ES256.
export function verifyOwnerSignatureWithProvider({
 payload,signatureRaw,publicJwk,createVerifier=createVerify
}={}){
 if(typeof payload!=='string'||!(signatureRaw instanceof Uint8Array)||
  signatureRaw.length!==64||!publicJwk)
  refuse('invalid-grant-signature');
 let verifier;
 try{verifier=createVerifier('sha256');}
 catch{refuse('grant-signature-provider-unavailable');}
 let pem,der;
 try{pem=keyFromJwk(publicJwk);der=rawEcdsaToDer(signatureRaw);}
 catch{refuse('invalid-grant-signature');}
 // Cross the Hatchable Node-crypto bridge using supported textual arguments.
 // UTF-8 payload and base64 DER preserve the exact signed bytes, while each
 // failure is categorized without exposing raw host exceptions.
 try{verifier.update(payload,'utf8');}
 catch{refuse('grant-signature-provider-update-error');}
 const signatureB64=btoa(String.fromCharCode(...der));
 try{return verifier.verify(pem,signatureB64,'base64')===true;}
 catch{refuse('grant-signature-provider-verify-error');}
}

export async function verifyDelegatedGrant({
 envelope,publicJwk,request,now=new Date().toISOString(),
 subtle=globalThis.crypto?.subtle
}={}){
 if(!subtle||!publicJwk||publicJwk.kty!=='EC'||publicJwk.crv!=='P-256')
  refuse('trusted-adjudicator-key-unavailable');
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>4096||
    !envelope.payload.length)refuse('invalid-grant-payload');
 const signature=decodeSignature(envelope.signature);
 const ok=verifyOwnerSignatureWithProvider({
  payload:envelope.payload,signatureRaw:signature,publicJwk});
 if(!ok)refuse('invalid-grant-signature');
 let grant;
 try{grant=JSON.parse(envelope.payload);}
 catch{refuse('invalid-grant-payload');}
 if(!grant||typeof grant!=='object'||Array.isArray(grant)||
    grant.schema!==GRANT_SCHEMA||grant.issuer!==ISSUER||
    grant.authorizedBy!==OWNER||
    grant.audience!==AUDIENCE||!GRANT_ID.test(grant.grantId||'')||
    !SHA256.test(grant.policySha||'')||
    typeof grant.administrativeChange!=='boolean')
  refuse('invalid-grant-claims');
 if(!OPERATIONS.has(grant.operation))refuse('unsupported-grant-operation');
 if(grant.operation==='pr.comment'&&
   (typeof grant.resource!=='string'||!PR_COMMENT_RESOURCE.test(grant.resource)||
    grant.administrativeChange!==false))
  refuse('invalid-grant-pr-comment-scope');
 // #420: pr.comment grants must carry the exact C04 PR-comment policy hash,
 // sha256('ultron.c04.owner-signed-coordinator-pr-comment.v1').
 if(grant.operation==='pr.comment'&&grant.policySha!==PR_COMMENT_POLICY_SHA)
  refuse('invalid-grant-policy');
 const versioned=Object.hasOwn(grant,'profileVersion')||
  Object.hasOwn(grant,'stopVersion');
 if(versioned&&(!Number.isSafeInteger(grant.profileVersion)||
  grant.profileVersion<1||!Number.isSafeInteger(grant.stopVersion)||
  grant.stopVersion<1))refuse('invalid-grant-versions');
 const begin=parseTime(grant.notBefore),end=parseTime(grant.expiresAt);
 if(end<=begin||end-begin>MAX_TTL_MS||
   (grant.operation==='pr.comment'&&end-begin>5*60*1000))
  refuse('grant-ttl-exceeded');
 const current=parseTime(now);
 if(current<begin)refuse('grant-not-yet-valid');
 if(current>=end)refuse('grant-expired');
 if(!request||!['actor','objectiveId','operation','resource'].every(key=>
    typeof request[key]==='string'&&request[key].length>0)||
    grant.actor!==request.actor||grant.objectiveId!==request.objectiveId||
    grant.operation!==request.operation||grant.resource!==request.resource||
    grant.administrativeChange!==request.administrativeChange)
  refuse('grant-scope-mismatch');
 if(grant.operation==='permissions.change'&&!grant.administrativeChange)
  refuse('administrative-grant-required');
 const verified=Object.freeze({
  authorized:true,authorizedBy:OWNER,grantId:grant.grantId,actor:grant.actor,
  objectiveId:grant.objectiveId,operation:grant.operation,
  resource:grant.resource,policySha:grant.policySha,
  ...(versioned?{profileVersion:grant.profileVersion,stopVersion:grant.stopVersion}:{}),
  notBefore:grant.notBefore,expiresAt:grant.expiresAt,
  administrativeChange:grant.administrativeChange
 });
 VERIFIED.add(verified);
 return verified;
}
// Consume once through a single SQL command; public API callers cannot forge a
// verifiedGrant by passing {authorized:true} because VERIFIED is module-private.
// A signed grant is not enough: admission must be bound atomically to the
// *current* owner profile, stop version, unpaused state and zero-cost policy.
// Legacy grants without signed version claims can be verified for audit but
// never consumed into fresh authority.
export async function consumeDelegatedGrant({db,verifiedGrant}={}){
 if(!db?.query||!VERIFIED.has(verifiedGrant))refuse('invalid-verified-grant');
 if(!Number.isSafeInteger(verifiedGrant.profileVersion)||
   verifiedGrant.profileVersion<1||
   !Number.isSafeInteger(verifiedGrant.stopVersion)||
   verifiedGrant.stopVersion<1)
  return {ok:false,error:'grant-unbound'};
 if(Date.parse(verifiedGrant.expiresAt)<=Date.now())
  return {ok:false,error:'grant-expired'};
 const sql=`WITH authority AS MATERIALIZED (
  SELECT 1 FROM brain_owner_autonomy_profile a
  JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'
    AND a.preset IN ('build','release')
    AND a.version=$8 AND c.version=$9 AND NOT c.paused
    AND a.max_paid_cents=0
    AND jsonb_exists(a.allowed_operations,$4::text)
  FOR SHARE
 ), gate AS MATERIALIZED (
  SELECT $7::timestamptz > clock_timestamp() AS live,
    EXISTS(SELECT 1 FROM authority) AS permitted
 ), admitted AS (
  INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
  SELECT $1,$2,$3,$4,$5,$6,$7::timestamptz
  FROM gate WHERE live AND permitted
  ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
 ), receipt AS (
  INSERT INTO brain_events(event_type,details)
  SELECT 'authority-grant-consumed',
   jsonb_build_object('grantId',grant_id,'operation',$4::text,'policySha',$6::text)
  FROM admitted RETURNING id
 )
 SELECT admitted.grant_id,receipt.id AS receipt_id,
   false AS expired,false AS denied
 FROM admitted JOIN receipt ON true
 UNION ALL
 SELECT NULL,NULL,NOT gate.live,NOT gate.permitted
 FROM gate WHERE NOT EXISTS(SELECT 1 FROM admitted)`;
 const result=await db.query(sql,[verifiedGrant.grantId,verifiedGrant.objectiveId,
  verifiedGrant.actor,verifiedGrant.operation,verifiedGrant.resource,
  verifiedGrant.policySha,verifiedGrant.expiresAt,verifiedGrant.profileVersion,
  verifiedGrant.stopVersion]);
 const row=result?.rows?.[0];
 if(row?.expired)return {ok:false,error:'grant-expired'};
 if(row?.denied)return {ok:false,error:'authority-denied'};
 return row?.grant_id?{ok:true,grantId:row.grant_id,receiptId:row.receipt_id}:
  {ok:false,error:'grant-replayed'};
}

// C04 positive-path composition: atomically bind the already-verified owner
// grant, its one-use nonce record, and the durable GitHub execution intent.
// The provider write is forbidden until this transaction returns `reserved`.
export async function reservePrCommentExecution({
 db,verifiedGrant,idempotencyKey,pullRequest,bodySha256,operationDigest
}={}){
 if(!db?.query||!VERIFIED.has(verifiedGrant))refuse('invalid-verified-grant');
 if(verifiedGrant.operation!=='pr.comment'||verifiedGrant.administrativeChange!==false||
   !/^ultron-task-[A-Za-z0-9][A-Za-z0-9_-]{0,90}$/.test(idempotencyKey||'')||
   !Number.isSafeInteger(pullRequest)||pullRequest<1||pullRequest>999999999||
   !SHA256.test(bodySha256||'')||!SHA256.test(operationDigest||'')||
   verifiedGrant.resource!==`github:pr-comment:michaeljwilliams0123/Ultron.MW:${pullRequest}:sha256:${bodySha256}`)
  refuse('invalid-pr-comment-execution');
 if(!Number.isSafeInteger(verifiedGrant.profileVersion)||verifiedGrant.profileVersion<1||
   !Number.isSafeInteger(verifiedGrant.stopVersion)||verifiedGrant.stopVersion<1)
  return {ok:false,error:'grant-unbound'};
 const sql=`WITH passkey AS MATERIALIZED (
  SELECT 1 AS enrolled FROM brain_owner_passkeys
  WHERE revoked_at IS NULL
  ORDER BY created_at LIMIT 1
 ), authority AS MATERIALIZED (
  SELECT 1 FROM brain_owner_autonomy_profile a
  JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'
    AND a.preset IN ('build','release') AND a.version=$10 AND c.version=$11
    AND NOT c.paused AND a.max_paid_cents=0
    AND jsonb_exists(a.allowed_operations,'pr.comment')
    AND EXISTS(SELECT 1 FROM passkey)
  FOR SHARE
 ), existing AS MATERIALIZED (
  SELECT idempotency_key,state,operation_digest,body_sha256,target_number
  FROM github_pr_comment_executions
  WHERE idempotency_key=$1 OR
   (repository='michaeljwilliams0123/Ultron.MW' AND
    target_number=$12 AND body_sha256=$13)
  UNION ALL
  SELECT idempotency_key,state,operation_digest,NULL::text,NULL::bigint
  FROM github_idempotent_executions WHERE idempotency_key=$1
 ), nonce AS (
  INSERT INTO brain_github_approval_nonces(
   nonce,operation,target_resource,approval_timestamp,expires_at)
  SELECT $2,'pr.comment',$3,$4::timestamptz,$5::timestamptz
  WHERE $5::timestamptz>clock_timestamp()
    AND EXISTS(SELECT 1 FROM authority)
    AND NOT EXISTS(SELECT 1 FROM existing)
  ON CONFLICT(nonce) DO NOTHING RETURNING nonce
 ), admitted AS (
  INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
  SELECT $2,$6,$7,'pr.comment',$3,$8,$5::timestamptz FROM nonce
  RETURNING grant_id
 ), execution AS (
  INSERT INTO github_pr_comment_executions(
   idempotency_key,operation_digest,repository,
   target_number,body_sha256,grant_id,persona_role,state)
  SELECT $1,$9,'michaeljwilliams0123/Ultron.MW',
   $12,$13,grant_id,'builder','reserved' FROM admitted
  RETURNING idempotency_key,state
 ), receipt AS (
  INSERT INTO brain_events(event_type,details)
  SELECT 'github-pr-comment-reserved',jsonb_build_object(
   'grantId',$2::text,'idempotencyKey',$1::text,'operationDigest',$9::text,
   'pullRequest',$12::bigint,'bodySha256',$13::text)
  FROM execution RETURNING id
 )
 SELECT 'reserved' AS outcome,e.idempotency_key,e.state,r.id AS receipt_id,
  true AS passkey_enrolled
 FROM execution e JOIN receipt r ON true
 UNION ALL
 SELECT 'existing',x.idempotency_key,x.state,NULL,
  EXISTS(SELECT 1 FROM passkey) FROM existing x
 WHERE NOT EXISTS(SELECT 1 FROM execution)
 UNION ALL
 SELECT 'denied',NULL,NULL,NULL,EXISTS(SELECT 1 FROM passkey)
 WHERE NOT EXISTS(SELECT 1 FROM execution) AND NOT EXISTS(SELECT 1 FROM existing)`;
 const result=await db.query(sql,[idempotencyKey,verifiedGrant.grantId,
  verifiedGrant.resource,verifiedGrant.notBefore,verifiedGrant.expiresAt,
  verifiedGrant.objectiveId,verifiedGrant.actor,verifiedGrant.policySha,
  operationDigest,verifiedGrant.profileVersion,verifiedGrant.stopVersion,
  pullRequest,bodySha256]);
 const row=result?.rows?.[0];
 if(row?.outcome==='reserved')return {ok:true,status:'reserved',
  idempotencyKey,receiptId:row.receipt_id};
 if(row?.outcome==='existing')return {ok:false,error:'execution-already-reserved',
  status:row.state};
 if(row?.passkey_enrolled===false)return {ok:false,error:'owner-passkey-required'};
 return {ok:false,error:Date.parse(verifiedGrant.expiresAt)<=Date.now()
  ?'grant-expired':'authority-or-replay-denied'};
}
