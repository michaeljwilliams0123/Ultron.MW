import {createHash} from 'node:crypto';
import {signRs256,parseRsaPrivateKey,base64url} from './rsa-pkcs1-sign.js';
import {verifyOwnerPasskeyAssertion} from './webauthn-owner.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const APP_ID=5633654;
const INSTALLATION_ID=179066535;
const API='https://api.github.com';
const SHA=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const KEY=/^ultron-chat-merge-pr[1-9][0-9]{0,8}-[a-f0-9]{24}$/;
const ROOM=/^(?:owner-main|chat-[a-f0-9-]{36})$/;
const GRANT=/^passkey-[A-Za-z0-9-]{16,96}$/;
const B64=/^[A-Za-z0-9_-]{16,8192}$/;
export const CHAT_MERGE_POLICY_SHA=createHash('sha256')
 .update('ultron.chat.owner-signed-squash-merge.v1').digest('hex');

const HELD=reason=>({ok:false,status:'held',reason});
const hash=v=>createHash('sha256').update(v).digest('hex');
const jsonB64=v=>base64url(Buffer.from(JSON.stringify(v),'utf8'));
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const asIso=d=>d instanceof Date?d.toISOString():new Date(d).toISOString();
const resource=p=>`github:pr-merge:${REPO}:${p.pullRequest}:head:${p.headSha}`;

function exact(o,keys){
 return o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
}
function validProof(p){
 return exact(p,['grantId','credentialId','authenticatorData','clientDataJSON','signature'])&&
  GRANT.test(p.grantId||'')&&['credentialId','authenticatorData','clientDataJSON','signature']
  .every(k=>typeof p[k]==='string'&&B64.test(p[k]));
}
export function validateMergeRequest(v){
 if(!exact(v,['pullRequest','headSha','idempotencyKey','room'])||
  !Number.isSafeInteger(v.pullRequest)||v.pullRequest<1||v.pullRequest>999999999||
  !SHA.test(v.headSha||'')||!KEY.test(v.idempotencyKey||'')||!ROOM.test(v.room||''))
  return null;
 return Object.freeze({pullRequest:v.pullRequest,headSha:v.headSha,
  idempotencyKey:v.idempotencyKey,room:v.room});
}
export function mergeOperationDigest(p,grantId){
 if(!validateMergeRequest(p)||!GRANT.test(grantId||''))throw Error('merge-request-invalid');
 return hash(JSON.stringify({schema:'ultron.github.pr-merge-attempt.v1',
  repository:REPO,operation:'pr.merge',pullRequest:p.pullRequest,
  headSha:p.headSha,idempotencyKey:p.idempotencyKey,grantId}));
}
function randomHex(n){
 return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)),
  b=>b.toString(16).padStart(2,'0')).join('');
}
function credentials(raw){
 const appId=Number(raw?.appId),installationId=Number(raw?.installationId);
 const privateKey=typeof raw?.privateKey==='string'?raw.privateKey.replace(/\\n/g,'\n'):'';
 if(appId!==APP_ID||installationId!==INSTALLATION_ID||!privateKey.includes('PRIVATE KEY'))
  throw Error('chat-executor-configuration-invalid');
 parseRsaPrivateKey(privateKey);
 return {appId,installationId,privateKey};
}
async function tokenForMerge(raw,fetchImpl,clock){
 const c=credentials(raw),now=clock(),seconds=Math.floor(now/1000);
 const unsigned=jsonB64({alg:'RS256',typ:'JWT'})+'.'+
  jsonB64({iat:seconds-30,exp:seconds+540,iss:String(c.appId)});
 const jwt=unsigned+'.'+base64url(signRs256(c.privateKey,unsigned));
 const res=await fetchImpl(`${API}/app/installations/${c.installationId}/access_tokens`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+jwt,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},
  body:JSON.stringify({repository_ids:[REPO_ID],
   permissions:{pull_requests:'write',contents:'write',metadata:'read'}})
 });
 if(res.status!==201)throw Error('chat-executor-token-denied');
 const body=await res.json();
 if(typeof body?.token!=='string'||!body.token)throw Error('chat-executor-token-invalid');
 return body.token;
}
export async function inspectPrForMerge({pullRequest,appCredentials,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(!Number.isSafeInteger(pullRequest)||pullRequest<1||pullRequest>999999999)
  return HELD('pr-number-invalid');
 const token=await tokenForMerge(appCredentials,fetchImpl,clock);
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2026-03-10'};
 const res=await fetchImpl(`${API}/repos/${REPO}/pulls/${pullRequest}`,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers});
 if(res.status===404)return HELD('pr-not-found');
 if(!res.ok)return HELD('github-read-unavailable');
 const p=await res.json();
 if(Number(p?.base?.repo?.id)!==REPO_ID||String(p?.base?.repo?.full_name)!==REPO||
  Number(p?.number)!==pullRequest||!SHA.test(p?.head?.sha||''))
  return HELD('repository-binding-mismatch');
 if(p.merged_at!==null||p.state!=='open'||p.draft===true)
  return HELD('pr-not-open-or-draft');
 if(p.mergeable===false)return HELD('pr-merge-conflict');
 const headSha=p.head.sha;
 const checksRes=await fetchImpl(`${API}/repos/${REPO}/commits/${headSha}/check-runs?per_page=50`,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers});
 let checks=[];
 if(checksRes.ok){
  const body=await checksRes.json().catch(()=>({}));
  if(Array.isArray(body?.check_runs))
   checks=body.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion}));
 }
 return {ok:true,pullRequest,title:String(p.title||'').slice(0,180),headSha,
  baseSha:SHA.test(p?.base?.sha||'')?p.base.sha:null,mergeable:p.mergeable===true,
  url:`https://github.com/${REPO}/pull/${pullRequest}`,checks,
  idempotencyKey:`ultron-chat-merge-pr${pullRequest}-${randomHex(12)}`};
}
const PREPARE=[
 "WITH policy AS MATERIALIZED (",
 " SELECT a.version AS profile_version,c.version AS stop_version",
 " FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1",
 " WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')",
 " AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0",
 " AND jsonb_exists(a.allowed_operations,'pr.merge') FOR SHARE",
 "), credential AS MATERIALIZED (",
 " SELECT credential_id FROM brain_owner_passkeys WHERE credential_id=$6 AND revoked_at IS NULL",
 "), saved AS (",
 " INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,",
 " actor,objective_id,operation,resource,policy_sha,administrative_change,",
 " profile_version,stop_version,expires_at)",
 " SELECT $1,$2,credential.credential_id,'mcp:ultron',$3,'pr.merge',$4,$5,FALSE,",
 " policy.profile_version,policy.stop_version,now()+interval '5 minutes'",
 " FROM (TABLE policy) AS policy CROSS JOIN (TABLE credential) AS credential RETURNING grant_id,expires_at",
 ") SELECT grant_id,expires_at AS \"expiresAt\" FROM (TABLE saved) AS saved"
].join('\n');
export async function beginPasskeyMergeChallenge({
 db,prepared:raw,credentialId,expectedProfileVersion,expectedStopVersion
}={}){
 const p=validateMergeRequest(raw);
 if(!p||typeof db?.query!=='function'||typeof credentialId!=='string'||
  !B64.test(credentialId)||credentialId.length>1024||
  !Number.isSafeInteger(expectedProfileVersion)||expectedProfileVersion<1||
  !Number.isSafeInteger(expectedStopVersion)||expectedStopVersion<1)
  return HELD('invalid-passkey-preparation');
 const grantId='passkey-'+crypto.randomUUID();
 const challenge=b64(crypto.getRandomValues(new Uint8Array(32)));
 try{
  const r=await db.query(PREPARE,[grantId,challenge,p.idempotencyKey,resource(p),
   CHAT_MERGE_POLICY_SHA,credentialId,expectedProfileVersion,expectedStopVersion]);
  if(r.rows?.length!==1)return HELD('passkey-owner-profile-or-credential-denied');
  return {ok:true,status:'prepared',grantId,challenge,credentialId,
   rpId:'ultron-mw-cloud.hatchable.site',expiresAt:asIso(r.rows[0].expiresAt),timeoutMs:120000};
 }catch{return HELD('passkey-challenge-unavailable');}
}
const READ_CHALLENGE=[
 'SELECT c.grant_id AS "grantId",c.challenge,c.credential_id AS "credentialId",',
 ' c.actor,c.objective_id AS "objectiveId",c.operation,c.resource,',
 ' c.policy_sha AS "policySha",c.administrative_change AS "administrativeChange",',
 ' c.profile_version AS "profileVersion",c.stop_version AS "stopVersion",',
 ' c.expires_at AS "expiresAt",c.used_at AS "usedAt",',
 ' k.public_key_spki AS "publicKeySpki",k.sign_count AS "signCount",k.revoked_at AS "revokedAt"',
 ' FROM brain_owner_passkey_challenges c',
 ' JOIN brain_owner_passkeys k ON k.credential_id=c.credential_id WHERE c.grant_id=$1'
].join('\n');
const CLAIM=[
 "WITH policy AS MATERIALIZED (",
 " SELECT 1 FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1",
 " WHERE a.id=1 AND a.owner='michaeljwilliams0123' AND a.preset IN ('build','release')",
 " AND a.version=$7 AND c.version=$8 AND NOT c.paused AND a.max_paid_cents=0",
 " AND jsonb_exists(a.allowed_operations,'pr.merge') FOR SHARE",
 "), existing AS MATERIALIZED (",
 " SELECT idempotency_key FROM github_pr_merge_executions WHERE idempotency_key=$1",
 " OR (repository='michaeljwilliams0123/Ultron.MW' AND target_number=$10 AND head_sha=$11)",
 "), claimed AS (",
 " UPDATE brain_owner_passkey_challenges ch SET used_at=now()",
 " WHERE ch.grant_id=$2 AND ch.credential_id=$3 AND ch.challenge=$4",
 " AND ch.actor='mcp:ultron' AND ch.objective_id=$1",
 " AND ch.operation='pr.merge' AND ch.resource=$5 AND ch.policy_sha=$6",
 " AND NOT ch.administrative_change AND ch.profile_version=$7 AND ch.stop_version=$8",
 " AND ch.used_at IS NULL AND ch.expires_at>clock_timestamp()",
 " AND EXISTS(SELECT 1 FROM (TABLE policy) AS policy) AND NOT EXISTS(SELECT 1 FROM (TABLE existing) AS existing)",
 " RETURNING ch.credential_id,ch.created_at,ch.expires_at",
 "), counter AS (",
 " UPDATE brain_owner_passkeys k SET sign_count=$9,last_used_at=now()",
 " FROM (TABLE claimed) AS claimed WHERE k.credential_id=claimed.credential_id AND k.revoked_at IS NULL",
 " AND ((k.sign_count=0 AND $9=0) OR $9>k.sign_count) RETURNING k.credential_id",
 "), nonce AS (",
 " INSERT INTO brain_github_approval_nonces(nonce,operation,target_resource,approval_timestamp,expires_at)",
 " SELECT $2,'pr.merge',$5,claimed.created_at,claimed.expires_at",
 " FROM (TABLE claimed) AS claimed WHERE EXISTS(SELECT 1 FROM (TABLE counter) AS counter)",
 " ON CONFLICT(nonce) DO NOTHING RETURNING nonce",
 "), admitted AS (",
 " INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)",
 " SELECT nonce.nonce,$1,'worker:coordinator','pr.merge',$5,$6,claimed.expires_at",
 " FROM (TABLE nonce) AS nonce CROSS JOIN (TABLE claimed) AS claimed ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id",
 "), execution AS (",
 " INSERT INTO github_pr_merge_executions(idempotency_key,operation_digest,repository,",
 " target_number,head_sha,grant_id,state)",
 " SELECT $1,$12,'michaeljwilliams0123/Ultron.MW',$10,$11,admitted.grant_id,'reserved'",
 " FROM (TABLE admitted) AS admitted RETURNING idempotency_key,state",
 "), receipt AS (",
 " INSERT INTO brain_events(event_type,details)",
 " SELECT 'github-pr-merge-reserved',jsonb_build_object('grantId',$2::text,",
 " 'idempotencyKey',$1::text,'operationDigest',$12::text,",
 " 'pullRequest',$10::bigint,'headSha',$11::text,'authority','owner-webauthn')",
 " FROM (TABLE execution) AS execution RETURNING id",
 ") SELECT 'reserved' AS outcome FROM (TABLE execution) AS execution JOIN (TABLE receipt) AS receipt ON true",
 " UNION ALL SELECT 'existing' AS outcome FROM (TABLE existing) AS existing",
 " WHERE NOT EXISTS(SELECT 1 FROM (TABLE execution) AS execution)",
 " UNION ALL SELECT 'denied' AS outcome",
 " WHERE NOT EXISTS(SELECT 1 FROM (TABLE execution) AS execution) AND NOT EXISTS(SELECT 1 FROM (TABLE existing) AS existing)"
].join('\n');
export async function verifyAndReservePasskeyMerge({db,prepared:raw,proof}={}){
 const p=validateMergeRequest(raw);
 if(!p||!validProof(proof)||typeof db?.query!=='function')return HELD('invalid-passkey-proof');
 let row;
 try{const r=await db.query(READ_CHALLENGE,[proof.grantId]);row=r.rows?.length===1?r.rows[0]:null;}
 catch{return HELD('passkey-readback-unavailable');}
 if(!row||row.usedAt||row.revokedAt||Date.parse(row.expiresAt)<=Date.now()||
  row.credentialId!==proof.credentialId||row.actor!=='mcp:ultron'||
  row.objectiveId!==p.idempotencyKey||row.operation!=='pr.merge'||
  row.resource!==resource(p)||row.policySha!==CHAT_MERGE_POLICY_SHA||
  row.administrativeChange!==false)
  return HELD('passkey-challenge-stale-or-mismatched');
 let sig;
 try{sig=await verifyOwnerPasskeyAssertion({
  credentialId:proof.credentialId,expectedCredentialId:row.credentialId,
  publicKeySpki:row.publicKeySpki,challenge:row.challenge,
  authenticatorData:proof.authenticatorData,clientDataJSON:proof.clientDataJSON,
  signature:proof.signature
 });}catch{return HELD('passkey-signature-invalid');}
 const signCount=sig.signCount;
 if((signCount===0&&Number(row.signCount)!==0)||(signCount!==0&&signCount<=Number(row.signCount)))
  return HELD('passkey-counter-replayed');
 const digest=mergeOperationDigest(p,proof.grantId);
 try{
  const r=await db.query(CLAIM,[p.idempotencyKey,proof.grantId,proof.credentialId,
   row.challenge,resource(p),CHAT_MERGE_POLICY_SHA,row.profileVersion,row.stopVersion,
   signCount,p.pullRequest,p.headSha,digest]);
  if(r.rows?.length!==1)return HELD('passkey-reservation-unavailable');
  const outcome=r.rows[0].outcome;
  if(outcome!=='reserved')return HELD(outcome==='existing'?'execution-already-reserved':'authority-or-passkey-replay-denied');
  return {ok:true,status:'reserved',idempotencyKey:p.idempotencyKey,grantId:proof.grantId,operationDigest:digest};
 }catch{return HELD('passkey-reservation-unavailable');}
}
async function postReceiptToChat(db,p,receipt){
 const body=`Verified squash merge completed for PR #${p.pullRequest}.\n`+
  `Head: ${p.headSha.slice(0,12)} · Merge commit: ${receipt.details.mergeCommitSha.slice(0,12)}\n`+
  `Receipt: ${receipt.details.url}`;
 const ctx=JSON.stringify({operation:'pr.merge',pullRequest:p.pullRequest,
  headSha:p.headSha,mergeCommitSha:receipt.details.mergeCommitSha,
  url:receipt.details.url,grantId:receipt.details.grantId,
  operationDigest:receipt.details.operationDigest,remoteVerified:true});
 const r=await db.query(`INSERT INTO council_room_messages
  (room_key,message_key,author_type,author_id,kind,body,context)
  VALUES($1,$2,'system','ultron-executor','receipt',$3,$4::jsonb)
  ON CONFLICT(message_key) DO UPDATE SET message_key=EXCLUDED.message_key
  RETURNING id`,[p.room,'receipt:'+p.idempotencyKey,body,ctx]);
 return r.rows?.[0]?.id??null;
}
export async function executeSquashMerge({
 db,prepared:raw,operationDigest:digest,grantId,appCredentials,fetchImpl=globalThis.fetch,clock=Date.now
}={}){
 const p=validateMergeRequest(raw);
 if(!p||typeof db?.query!=='function'||!SHA256.test(digest||'')||!GRANT.test(grantId||''))
  throw Error('chat-executor-service-invalid');
 const token=await tokenForMerge(appCredentials,fetchImpl,clock);
 const moved=await db.query(`UPDATE github_pr_merge_executions SET state='in_flight',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2 AND state='reserved' RETURNING idempotency_key`,
  [p.idempotencyKey,digest]);
 if(moved.rows?.length!==1)throw Error('chat-executor-dispatch-not-admitted');
 try{
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'};
  const put=await fetchImpl(`${API}/repos/${REPO}/pulls/${p.pullRequest}/merge`,{
   method:'PUT',redirect:'error',signal:AbortSignal.timeout(15000),headers,
   body:JSON.stringify({merge_method:'squash',sha:p.headSha})
  });
  if(put.status!==200)throw Error('chat-executor-merge-denied-'+put.status);
  const putBody=await put.json();
  if(putBody?.merged!==true||!SHA.test(putBody?.sha||''))throw Error('chat-executor-merge-response-mismatch');
  const readback=await fetchImpl(`${API}/repos/${REPO}/pulls/${p.pullRequest}`,{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers});
  if(readback.status!==200)throw Error('chat-executor-readback-unavailable');
  const pr=await readback.json();
  if(pr?.merged!==true||pr?.merge_commit_sha!==putBody.sha||pr?.head?.sha!==p.headSha)
   throw Error('chat-executor-readback-mismatch');
  const url=`https://github.com/${REPO}/pull/${p.pullRequest}`;
  const receipt={idempotencyKey:p.idempotencyKey,status:'completed',details:{
   repository:REPO,operation:'pr.merge',operationDigest:digest,grantId,
   pullRequest:p.pullRequest,headSha:p.headSha,mergeCommitSha:pr.merge_commit_sha,
   url,remoteVerified:true}};
  await db.query(`UPDATE github_pr_merge_executions SET state='completed',
   merge_commit_sha=$3,provider_url=$4,receipt=$5::jsonb,updated_at=now()
   WHERE idempotency_key=$1 AND operation_digest=$2 AND state='in_flight'`,
   [p.idempotencyKey,digest,pr.merge_commit_sha,url,JSON.stringify(receipt)]);
  const messageId=await postReceiptToChat(db,p,receipt);
  return {ok:true,status:'completed',idempotencyKey:p.idempotencyKey,receipt,messageId};
 }catch(error){
  try{await db.query(`UPDATE github_pr_merge_executions SET state='reconcile_required',updated_at=now()
   WHERE idempotency_key=$1 AND state IN ('reserved','in_flight')`,[p.idempotencyKey]);}catch{}
  return {ok:false,status:'reconcile-required',idempotencyKey:p.idempotencyKey,
   reason:String(error?.message||'merge-outcome-unresolved')};
 }
}
export async function reconcileSquashMerge({
 db,prepared:raw,operationDigest:digest,grantId,appCredentials,fetchImpl=globalThis.fetch,clock=Date.now
}={}){
 const p=validateMergeRequest(raw);
 if(!p||typeof db?.query!=='function'||!SHA256.test(digest||''))return HELD('request-invalid');
 const r=await db.query(`SELECT state,receipt,merge_commit_sha FROM github_pr_merge_executions
  WHERE idempotency_key=$1 AND operation_digest=$2`,[p.idempotencyKey,digest]);
 const stored=r.rows?.[0];
 if(!stored)return HELD('execution-not-found');
 if(stored.state==='completed')return {ok:true,status:'completed',idempotencyKey:p.idempotencyKey,receipt:stored.receipt};
 if(!['in_flight','reconcile_required'].includes(stored.state))return HELD('reconciliation-not-admitted');
 const token=await tokenForMerge(appCredentials,fetchImpl,clock);
 const readback=await fetchImpl(`${API}/repos/${REPO}/pulls/${p.pullRequest}`,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}
 });
 if(readback.status!==200)return {ok:false,status:'reconcile-required',reason:'readback-unavailable'};
 const pr=await readback.json();
 if(pr?.merged===true&&SHA.test(pr?.merge_commit_sha||'')&&pr?.head?.sha===p.headSha){
  const url=`https://github.com/${REPO}/pull/${p.pullRequest}`;
  const receipt={idempotencyKey:p.idempotencyKey,status:'reconciled_success',details:{
   repository:REPO,operation:'pr.merge',operationDigest:digest,grantId:grantId||null,
   pullRequest:p.pullRequest,headSha:p.headSha,mergeCommitSha:pr.merge_commit_sha,
   url,remoteVerified:true}};
  await db.query(`UPDATE github_pr_merge_executions SET state='completed',
   merge_commit_sha=$3,provider_url=$4,receipt=$5::jsonb,updated_at=now()
   WHERE idempotency_key=$1 AND operation_digest=$2 AND state IN ('in_flight','reconcile_required')`,
   [p.idempotencyKey,digest,pr.merge_commit_sha,url,JSON.stringify(receipt)]);
  const messageId=await postReceiptToChat(db,p,receipt);
  return {ok:true,status:'completed',idempotencyKey:p.idempotencyKey,receipt,messageId};
 }
 return {ok:false,status:'reconcile-required',idempotencyKey:p.idempotencyKey,reason:'pr-still-not-merged'};
}
