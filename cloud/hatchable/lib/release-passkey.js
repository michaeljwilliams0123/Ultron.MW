import {verifyOwnerPasskeyAssertion} from './webauthn-owner.js';
import {verifyLiveHatchableManifest} from './hatchable-manifest-readback.js';
import {normalizeDeploymentReceiptRequest,deploymentReceiptResource,
 prepareDeploymentReleaseReceipt,DEPLOYMENT_RECEIPT_POLICY_SHA} from './deployment-release-receipt/read.js';
const OWNER='michaeljwilliams0123', RP='ultron-mw-cloud.hatchable.site';
const MAIN='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main';
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
const B64=/^[A-Za-z0-9_-]+$/;
const enc=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const validProof=p=>exact(p,['grantId','credentialId','authenticatorData','clientDataJSON','signature'])&&
 /^passkey-[A-Za-z0-9-]{16,96}$/.test(p.grantId||'')&&
 ['credentialId','authenticatorData','clientDataJSON','signature'].every(k=>typeof p[k]==='string'&&p[k].length<=8192&&B64.test(p[k]));
async function verifyTarget({input,config,fetchGithub,verifyManifest}){
 try{
  const r=await fetchGithub(MAIN,{method:'GET',cache:'no-store'});
  if(!r.ok||r.status!==200||(await r.json())?.object?.sha!==input.sourceSha)return false;
  const m=await verifyManifest({config,fetchGithub,deploymentRow:{target:input.target,source_sha:input.sourceSha,artifact_digest:input.artifactDigest,manifest_file_count:input.manifestFileCount}});
  if(!m?.verified||m.target!==input.target||m.sourceSha!==input.sourceSha||
   m.artifactDigest!==input.artifactDigest||m.manifestFileCount!==input.manifestFileCount)return false;
  const again=await fetchGithub(MAIN,{method:'GET',cache:'no-store'});
  return again.ok&&again.status===200&&(await again.json())?.object?.sha===input.sourceSha;
 }catch{return false;}
}
const BEGIN=`WITH policy AS MATERIALIZED (
 SELECT a.version AS profile_version,c.version AS stop_version
 FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
 WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')
 AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0
 AND jsonb_exists(a.allowed_operations,'cloud.deploy') FOR SHARE
), credential AS MATERIALIZED (
 SELECT credential_id FROM brain_owner_passkeys WHERE credential_id=$3 AND revoked_at IS NULL
), saved AS (
 INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,
 actor,objective_id,operation,resource,policy_sha,administrative_change,profile_version,stop_version,expires_at)
 SELECT $1,$2,credential.credential_id,'mcp:ultron',$4,'cloud.deploy',$5,$6,FALSE,
 policy.profile_version,policy.stop_version,now()+interval '5 minutes'
 FROM (TABLE policy) AS policy CROSS JOIN (TABLE credential) AS credential RETURNING expires_at
) SELECT expires_at AS "expiresAt" FROM (TABLE saved) AS saved`;
const READ=`SELECT c.grant_id AS "grantId",c.challenge,c.credential_id AS "credentialId",
 c.actor,c.objective_id AS "objectiveId",c.operation,c.resource,c.policy_sha AS "policySha",
 c.administrative_change AS "administrativeChange",c.profile_version AS "profileVersion",
 c.stop_version AS "stopVersion",c.expires_at AS "expiresAt",c.used_at AS "usedAt",
 k.public_key_spki AS "publicKeySpki",k.sign_count AS "signCount",k.revoked_at AS "revokedAt"
 FROM brain_owner_passkey_challenges c JOIN brain_owner_passkeys k ON k.credential_id=c.credential_id
 WHERE c.grant_id=$1`;
const CLAIM=`WITH policy AS MATERIALIZED (
 SELECT 1 FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
 WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')
 AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0
 AND jsonb_exists(a.allowed_operations,'cloud.deploy') FOR SHARE
), existing AS MATERIALIZED (
 SELECT id FROM brain_deployment_release_receipts WHERE receipt_key=$1 OR grant_id=$2
 OR (target=$10 AND source_sha=$11 AND artifact_digest=$12)
), claimed AS (
 UPDATE brain_owner_passkey_challenges ch SET used_at=now()
 WHERE ch.grant_id=$2 AND ch.credential_id=$3 AND ch.challenge=$4
 AND ch.actor='mcp:ultron' AND ch.objective_id=$1 AND ch.operation='cloud.deploy'
 AND ch.resource=$5 AND ch.policy_sha=$6 AND NOT ch.administrative_change
 AND ch.profile_version=$7 AND ch.stop_version=$8 AND ch.used_at IS NULL
 AND ch.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM (TABLE policy) AS policy)
 AND NOT EXISTS(SELECT 1 FROM (TABLE existing) AS existing)
 RETURNING credential_id,expires_at
), counter AS (
 UPDATE brain_owner_passkeys k SET sign_count=$9,last_used_at=now()
 FROM (TABLE claimed) AS claimed WHERE k.credential_id=claimed.credential_id
 AND k.revoked_at IS NULL AND ((k.sign_count=0 AND $9=0) OR $9>k.sign_count)
 RETURNING k.credential_id
), admitted AS (
 INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
 SELECT $2,$1,'mcp:ultron','cloud.deploy',$5,$6,claimed.expires_at
 FROM (TABLE claimed) AS claimed WHERE EXISTS(SELECT 1 FROM (TABLE counter) AS counter)
 ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
), recorded AS (
 INSERT INTO brain_deployment_release_receipts(receipt_key,target,source_sha,artifact_digest,
 manifest_file_count,independent_readback,grant_id,policy_sha,profile_version,stop_version)
 SELECT $1,$10,$11,$12,$13,true,grant_id,$6,$7,$8 FROM (TABLE admitted) AS admitted
 RETURNING id,grant_id
), event AS (
 INSERT INTO brain_events(event_type,details)
 SELECT 'deployment-release-receipt-recorded',jsonb_build_object('receiptId',id,
 'key',$1::text,'target',$10::text,'sourceSha',$11::text,'artifactDigest',$12::text,
 'grantId',grant_id,'authority','owner-webauthn') FROM (TABLE recorded) AS recorded RETURNING id
) SELECT r.id AS "receiptId",r.grant_id AS "grantId"
 FROM (TABLE recorded) AS r JOIN (TABLE event) AS e ON true`;
export async function prepareReleasePasskey({db,config,request,credentialId,fetchGithub,verifyManifest=verifyLiveHatchableManifest}={}){
 const input=normalizeDeploymentReceiptRequest(request);
 if(!input||typeof credentialId!=='string'||credentialId.length<16||credentialId.length>1024||!B64.test(credentialId)||typeof db?.query!=='function')return held('request-invalid');
 if(!await verifyTarget({input,config,fetchGithub,verifyManifest}))return held('live-release-not-verified');
 const p=await prepareDeploymentReleaseReceipt({db,request:input});
 if(!p.ok)return p;
 const grantId='passkey-'+crypto.randomUUID(),challenge=enc(crypto.getRandomValues(new Uint8Array(32)));
 try{
  const g=p.grantRequest,r=await db.query(BEGIN,[grantId,challenge,credentialId,input.key,g.resource,g.policySha,g.profileVersion,g.stopVersion]);
  if(r.rows?.length!==1)return held('passkey-profile-or-credential-denied');
  return {ok:true,status:'prepared',grantId,challenge,credentialId,rpId:RP,expiresAt:new Date(r.rows[0].expiresAt).toISOString(),timeoutMs:120000};
 }catch{return uncertain('passkey-challenge-unavailable');}
}
export async function submitReleasePasskey({db,config,request,proof,fetchGithub,verifyManifest=verifyLiveHatchableManifest}={}){
 const input=normalizeDeploymentReceiptRequest(request);
 if(!input||!validProof(proof)||typeof db?.query!=='function')return held('request-invalid');
 let row;
 try{const r=await db.query(READ,[proof.grantId]);row=r.rows?.length===1?r.rows[0]:null;}catch{return uncertain('passkey-readback-unavailable');}
 const resource=deploymentReceiptResource(input);
 if(!row||row.usedAt||row.revokedAt||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=Date.now()||
 row.credentialId!==proof.credentialId||row.actor!=='mcp:ultron'||row.objectiveId!==input.key||
 row.operation!=='cloud.deploy'||row.resource!==resource||row.policySha!==DEPLOYMENT_RECEIPT_POLICY_SHA||
 row.administrativeChange!==false||!Number.isSafeInteger(Number(row.profileVersion))||Number(row.profileVersion)<1||
 !Number.isSafeInteger(Number(row.stopVersion))||Number(row.stopVersion)<1)return held('passkey-challenge-stale-or-mismatched');
 let verified;
 try{verified=await verifyOwnerPasskeyAssertion({credentialId:proof.credentialId,expectedCredentialId:row.credentialId,
 publicKeySpki:row.publicKeySpki,challenge:row.challenge,authenticatorData:proof.authenticatorData,
 clientDataJSON:proof.clientDataJSON,signature:proof.signature});}catch{return held('passkey-signature-invalid');}
 if(!((Number(row.signCount)===0&&verified.signCount===0)||verified.signCount>Number(row.signCount)))return held('passkey-counter-replayed');
 if(!await verifyTarget({input,config,fetchGithub,verifyManifest}))return uncertain('live-release-not-verified');
 try{
  const r=await db.query(CLAIM,[input.key,proof.grantId,proof.credentialId,row.challenge,resource,
   DEPLOYMENT_RECEIPT_POLICY_SHA,Number(row.profileVersion),Number(row.stopVersion),verified.signCount,
   input.target,input.sourceSha,input.artifactDigest,input.manifestFileCount]);
  if(r.rows?.length!==1||r.rows[0].grantId!==proof.grantId)return uncertain('receipt-not-observed');
  return {ok:true,status:'observed',receiptId:String(r.rows[0].receiptId),grantId:proof.grantId,
   key:input.key,target:input.target,sourceSha:input.sourceSha,artifactDigest:input.artifactDigest,manifestFileCount:input.manifestFileCount};
 }catch{return uncertain('receipt-outcome-unresolved');}
}
