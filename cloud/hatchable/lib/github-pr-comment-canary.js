import {createHash} from 'node:crypto';
import {signRs256,parseRsaPrivateKey,base64url} from 'lib/rsa-pkcs1-sign.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const APP_ID=5633654;
const INSTALLATION_ID=179066535;
const BOT_LOGIN='ultron-coordinator[bot]';
const BOT_ID=353078104;
const API='https://api.github.com';
const SHA256=/^[a-f0-9]{64}$/;
const KEY=/^ultron-task-c04-pr[1-9][0-9]{0,8}-[a-f0-9]{24}$/;
const POLICY_SHA=createHash('sha256').update(
 'ultron.c04.owner-signed-coordinator-pr-comment.v1').digest('hex');

// Only fixed reason codes may cross the API or enter the durable stage ledger.
const PR_COMMENT_FAILURES=Object.freeze({
 'configuration-invalid':{stage:'credential_exchange',dispatched:false},
 'clock-invalid':{stage:'credential_exchange',dispatched:false},
 'token-exchange-denied':{stage:'credential_exchange',dispatched:false},
 'token-exchange-unavailable':{stage:'credential_exchange',dispatched:false},
 'token-response-invalid':{stage:'credential_exchange',dispatched:false},
 'dispatch-not-admitted':{stage:'dispatch_admission',dispatched:false},
 'provider-write-denied':{stage:'provider_write',dispatched:null},
 'provider-outcome-unknown':{stage:'provider_write',dispatched:null},
 'provider-response-mismatch':{stage:'provider_write',dispatched:null},
 'readback-unavailable':{stage:'provider_readback',dispatched:null},
 'readback-mismatch':{stage:'provider_readback',dispatched:null},
 'readback-not-found':{stage:'provider_readback',dispatched:null},
 'readback-conflict':{stage:'provider_readback',dispatched:null},
 'intent-conflict':{stage:'reconciliation',dispatched:null},
 'reconciliation-not-admitted':{stage:'reconciliation',dispatched:null},
 'ledger-readback-unavailable':{stage:'reconciliation',dispatched:null},
 'receipt-persistence-unverified':{stage:'receipt_persistence',dispatched:null}
});
export function classifyPrCommentFailure(error){
 const message=typeof error?.message==='string'?error.message:'';
 const prefix='github-pr-comment-canary-';
 const code=message.startsWith(prefix)?message.slice(prefix.length):'';
 const detail=Object.hasOwn(PR_COMMENT_FAILURES,code)?PR_COMMENT_FAILURES[code]:null;
 return Object.freeze(detail?{stage:detail.stage,reason:code,dispatched:detail.dispatched}:
  {stage:'unknown',reason:'unclassified',dispatched:null});
}
const SAFE_STAGES=new Set(['credential_scoped','credential_exchange_failed',
 'provider_write_intent','provider_acknowledged','remote_observed',
 'reconcile_required','reconciliation_started','reconciliation_unresolved']);
async function recordPrCommentStage(db,prepared,stage,reason=null){
 if(!SAFE_STAGES.has(stage)||(reason!==null&&reason!=='unclassified'&&
  !Object.hasOwn(PR_COMMENT_FAILURES,reason)))fail('stage-request-invalid');
 // No token, signature, private key, provider body, or arbitrary exception string.
 // This append-only event is independent of the immutable execution receipt.
 const result=await db.query(`INSERT INTO brain_events(event_type,details)
  SELECT 'github-pr-comment-stage',
   jsonb_build_object('idempotencyKey',$1::text,'stage',$2::text,'reason',$3::text)
  WHERE EXISTS(SELECT 1 FROM github_pr_comment_executions WHERE idempotency_key=$1)
  RETURNING id`,[prepared.idempotencyKey,stage,reason]);
 if(result?.rows?.length!==1)fail('stage-persistence-unavailable');
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>base64url(Buffer.from(JSON.stringify(value),'utf8'));
function randomHex(length){
 if(typeof globalThis.crypto?.getRandomValues!=='function')fail('entropy-unavailable');
 return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(length)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
}
function fail(message){throw Error('github-pr-comment-canary-'+message);}
function positive(value){
 const text=String(value??'');
 if(!/^[1-9][0-9]*$/.test(text))fail('configuration-invalid');
 const number=Number(text);
 if(!Number.isSafeInteger(number))fail('configuration-invalid');
 return number;
}
function databaseId(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return value;
 if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)){
  const number=Number(value);
  if(Number.isSafeInteger(number))return number;
 }
 fail('ledger-readback-unavailable');
}
function exact(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  Object.keys(value).every(key=>keys.includes(key));
}
// Ledger table created by migration 0041 (github_pr_comment_executions).
// Until it exists, the canary reports not-configured instead of attempting a
// reservation or provider write.
const LEDGER_TABLE='github_pr_comment_executions';
const LEDGER_COLUMNS=['idempotency_key','operation_digest','repository',
 'target_number','body_sha256','grant_id','persona_role','state',
 'provider_comment_id','provider_url','provider_actor','provider_app_id','receipt'];
const CONFIG_NAMES={appId:'ULTRON_GITHUB_APP_ID',installationId:'ULTRON_GITHUB_INSTALLATION_ID',
 privateKey:'ULTRON_GITHUB_APP_PRIVATE_KEY',ownerJwk:'ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK'};
export const PR_COMMENT_CANARY_CONFIG=Object.freeze({...CONFIG_NAMES});
// Default-off kill switch. The canary may only act when this flag is exactly
// the string 'true'. Unset, empty, unreadable or any other value means disabled.
export const PR_COMMENT_CANARY_ENABLE_FLAG='ULTRON_PR_COMMENT_CANARY_ENABLED';
export async function prCommentCanaryEnabled(readConfig){
 if(typeof readConfig!=='function')return false;
 try{return (await readConfig(PR_COMMENT_CANARY_ENABLE_FLAG))==='true';}
 catch{return false;}
}
async function readOptional(readConfig,name){
 try{const value=await readConfig(name);return typeof value==='string'?value:
  value==null?'':String(value);}catch{return '';}
}
// Reports only which prerequisites are missing, by name. Never returns or
// logs a credential value.
export async function prCommentCanaryReadiness({db,readConfig}={}){
 const missing=[];
 if(typeof readConfig!=='function')missing.push('github-app-credentials','owner-authority-public-jwk');
 else{
  const [appId,installationId,privateKey,ownerJwk]=await Promise.all([
   readOptional(readConfig,CONFIG_NAMES.appId),
   readOptional(readConfig,CONFIG_NAMES.installationId),
   readOptional(readConfig,CONFIG_NAMES.privateKey),
   readOptional(readConfig,CONFIG_NAMES.ownerJwk)]);
  if(!appId||!installationId||!privateKey)missing.push('github-app-credentials');
  else if(appId!==String(APP_ID)||installationId!==String(INSTALLATION_ID))
   missing.push('github-app-credentials-mismatch');
  else{try{parseRsaPrivateKey(privateKey);}catch{missing.push('github-app-private-key-unusable');}}
  if(ownerJwk.length<20||ownerJwk.length>4096)missing.push('owner-authority-public-jwk');
 }
 let ledger=false;
 if(typeof db?.query==='function'){
  try{
   const result=await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=$2
     AND column_name = ANY($1::text[])`,[LEDGER_COLUMNS,LEDGER_TABLE]);
   ledger=Number(result?.rows?.[0]?.n)===LEDGER_COLUMNS.length;
  }catch{ledger=false;}
 }
 if(!ledger)missing.push('migration-0041');
 const enabled=await prCommentCanaryEnabled(readConfig);
 const ready=missing.length===0;
 return Object.freeze({enabled,prerequisitesReady:ready,configured:enabled&&ready,
  status:!enabled?'disabled':ready?'configured':'not-configured',
  reason:!enabled?'canary-disabled':ready?null:'canary-not-configured',
  missing:Object.freeze(missing)});
}
export function canonicalCanaryComment({pullRequest,idempotencyKey}={}){
 if(!Number.isSafeInteger(pullRequest)||pullRequest<1||pullRequest>999999999||
   !KEY.test(idempotencyKey||''))fail('request-invalid');
 return `C04 owner-signed Coordinator App canary for #${pullRequest}.\n\n`+
  'Scope: one exact PR comment, $0 paid inference, independent readback, '+
  'durable PostgreSQL receipt, and no automatic retry.\n\n'+
  `<!-- ultron-c04-owner-app-canary:${idempotencyKey} -->`;
}
export async function preparePrCommentCanary({db,pullRequest}={}){
 if(typeof db?.query!=='function'||!Number.isSafeInteger(pullRequest)||
   pullRequest<1||pullRequest>999999999)fail('request-invalid');
 const state=(await db.query(`SELECT a.version AS profile_version,
  c.version AS stop_version,c.paused,a.max_paid_cents,
  jsonb_exists(a.allowed_operations,'pr.comment') AS allowed
  FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'`)).rows?.[0];
 if(!state||state.paused||state.max_paid_cents!==0||state.allowed!==true)
  fail('authority-state-denied');
 const idempotencyKey=`ultron-task-c04-pr${pullRequest}-${randomHex(12)}`;
 const commentBody=canonicalCanaryComment({pullRequest,idempotencyKey});
 const bodySha256=hash(commentBody);
 const resource=`github:pr-comment:${REPO}:${pullRequest}:sha256:${bodySha256}`;
 const ownerGrantRequest={
  actor:'worker:coordinator',administrativeChange:false,
  objectiveId:idempotencyKey,operation:'pr.comment',policySha:POLICY_SHA,
  profileVersion:Number(state.profile_version),resource,
  stopVersion:Number(state.stop_version)
 };
 return Object.freeze({pullRequest,idempotencyKey,commentBody,bodySha256,
  ownerGrantRequest:Object.freeze(ownerGrantRequest)});
}
export function validatePreparedCanary(value){
 const keys=['pullRequest','idempotencyKey','commentBody','bodySha256'];
 const allowed=exact(value,keys)||exact(value,[...keys,'ownerGrantRequest']);
 if(!allowed||
   !Number.isSafeInteger(value.pullRequest)||value.pullRequest<1||
   value.pullRequest>999999999||!KEY.test(value.idempotencyKey||'')||
   !SHA256.test(value.bodySha256||''))fail('request-invalid');
 const expected=canonicalCanaryComment(value);
 if(value.commentBody!==expected||hash(expected)!==value.bodySha256)
  fail('request-invalid');
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,value[key]])));
}
export function operationDigest(prepared,grantId){
 if(!KEY.test(prepared?.idempotencyKey||'')||
   typeof grantId!=='string'||grantId.length<8)fail('request-invalid');
 return hash(JSON.stringify({schema:'ultron.github.pr-comment-attempt.v1',
  repository:REPO,operation:'pr.comment',pullRequest:prepared.pullRequest,
  bodySha256:prepared.bodySha256,idempotencyKey:prepared.idempotencyKey,grantId}));
}
function credentials(value){
 const appId=positive(value?.appId),installationId=positive(value?.installationId);
 const privateKey=typeof value?.privateKey==='string'
  ?value.privateKey.replace(/\\n/g,'\n'):'';
 if(appId!==APP_ID||installationId!==INSTALLATION_ID||
   !privateKey.includes('PRIVATE KEY'))fail('configuration-invalid');
 return {appId,installationId,privateKey};
}
async function provider(fetchImpl,url,options={}){
 let response;
 try{response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),...options});}
 catch{fail('provider-outcome-unknown');}
 return response;
}
// GitHub stamps expires_at as its own clock + 60 minutes, measured after our
// pre-request clock() read, so a strict now+3600s bound rejects every real
// exchange. Allow bounded request latency and clock skew, nothing more.
const TOKEN_EXPIRY_SKEW_MS=5*60000;
async function tokenForComment(raw,fetchImpl,clock){
 const c=credentials(raw),now=clock(),seconds=Math.floor(now/1000);
 if(!Number.isSafeInteger(now)||seconds<1)fail('clock-invalid');
 const unsigned=json({alg:'RS256',typ:'JWT'})+'.'+
  json({iat:seconds-30,exp:seconds+540,iss:String(c.appId)});
 let jwt;
 try{jwt=unsigned+'.'+base64url(signRs256(c.privateKey,unsigned));}
 catch{fail('configuration-invalid');}
 const permissions={issues:'write',metadata:'read'};
 let response;
 try{
  response=await provider(fetchImpl,
   `${API}/app/installations/${c.installationId}/access_tokens`,{
    method:'POST',headers:{Authorization:'Bearer '+jwt,
     Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
     'Content-Type':'application/json'},
    body:JSON.stringify({repository_ids:[REPO_ID],permissions})});
 }catch{
  // Installation-token transport loss occurs BEFORE effect dispatch.
  fail('token-exchange-unavailable');
 }
 if(response.status!==201)fail('token-exchange-denied');
 let body;
 try{body=await response.json();}catch{fail('token-response-invalid');}
 if(typeof body?.token!=='string'||!body.token||
   body.permissions?.issues!=='write'||body.permissions?.metadata!=='read'||
   Object.keys(body.permissions).length!==2||!Array.isArray(body.repositories)||
   body.repositories.length!==1||body.repositories[0]?.id!==REPO_ID||
   body.repositories[0]?.full_name!==REPO||
   !(Date.parse(body.expires_at)>now&&
     Date.parse(body.expires_at)<=now+3600000+TOKEN_EXPIRY_SKEW_MS))
  fail('token-response-invalid');
 return body.token;
}
function verifiedComment(value,prepared){
 return value&&Number.isSafeInteger(Number(value.id))&&Number(value.id)>0&&
  value.body===prepared.commentBody&&value.user?.login===BOT_LOGIN&&
  Number(value.user?.id)===BOT_ID&&value.user?.type==='Bot'&&
  Number(value.performed_via_github_app?.id)===APP_ID&&
  value.performed_via_github_app?.slug==='ultron-coordinator'&&
  typeof value.html_url==='string'&&
  new RegExp('^https://github[.]com/michaeljwilliams0123/Ultron[.]MW/(issues|pull)/'+
   prepared.pullRequest+'#issuecomment-'+value.id+'$').test(value.html_url);
}
function readHeaders(token){
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
 if(typeof token==='string'&&token)headers.Authorization='Bearer '+token;
 return headers;
}
// Readbacks use the installation token: anonymous GitHub reads share a
// 60-request/hour per-IP budget across the hosting egress and fail unpredictably.
async function independentRead(fetchImpl,id,prepared,token){
 const response=await provider(fetchImpl,`${API}/repos/${REPO}/issues/comments/${id}`,{
  headers:readHeaders(token)});
 if(response.status!==200)fail('readback-unavailable');
 let body;try{body=await response.json();}catch{fail('readback-unavailable');}
 if(!verifiedComment(body,prepared))fail('readback-mismatch');
 return body;
}
async function row(db,key){
 const result=await db.query(`SELECT idempotency_key,state,operation_digest,
  target_number,body_sha256,grant_id,created_at,receipt
  FROM github_pr_comment_executions WHERE idempotency_key=$1`,[key]);
 if(result?.rows?.length!==1)fail('ledger-readback-unavailable');
 return result.rows[0];
}
async function markReconcile(db,prepared){
 try{await db.query(`UPDATE github_pr_comment_executions
  SET state='reconcile_required',updated_at=now()
  WHERE idempotency_key=$1 AND state IN ('reserved','in_flight')`,
 [prepared.idempotencyKey]);}catch{}
 return row(db,prepared.idempotencyKey);
}
async function complete(db,prepared,digest,comment,status){
 const receipt={idempotencyKey:prepared.idempotencyKey,status,details:{
  repository:REPO,operationDigest:digest,pullRequest:prepared.pullRequest,
  bodySha256:prepared.bodySha256,commentId:Number(comment.id),
  commentUrl:comment.html_url,actor:BOT_LOGIN,appId:APP_ID,
  personaRole:'builder',remoteVerified:true}};
 try{await db.query(`UPDATE github_pr_comment_executions SET
  state='completed',provider_comment_id=$3,provider_url=$4,
  provider_actor=$5,provider_app_id=$6,receipt=$7::jsonb,updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2
   AND state IN ('in_flight','reconcile_required')`,
 [prepared.idempotencyKey,digest,Number(comment.id),comment.html_url,
  BOT_LOGIN,APP_ID,JSON.stringify(receipt)]);}catch{}
 const stored=await row(db,prepared.idempotencyKey);
 if(stored.state!=='completed'||stored.receipt?.details?.commentId!==Number(comment.id))
  fail('receipt-persistence-unverified');
 return Object.freeze({status,receipt:stored.receipt});
}
export async function submitPrCommentCanary({
 db,prepared,operationDigest:digest,appCredentials,fetchImpl=globalThis.fetch,
 clock=Date.now
}={}){
 prepared=validatePreparedCanary(prepared);
 if(typeof db?.query!=='function'||!SHA256.test(digest||'')||
   typeof fetchImpl!=='function'||typeof clock!=='function')fail('service-invalid');

 let token;
 try{token=await tokenForComment(appCredentials,fetchImpl,clock);}
 catch(error){
  // A caller may probe token validity without reserving an execution.
  // Never let an optional diagnostic hide the original pre-dispatch failure.
  try{await recordPrCommentStage(db,prepared,'credential_exchange_failed',
   classifyPrCommentFailure(error).reason);}catch{}
  throw error;
 }
 await recordPrCommentStage(db,prepared,'credential_scoped');
 // Claim write intent and append the audit event in ONE DB transaction, prior
 // to the only effectful provider POST. A failed event cannot leave a claim
 // that silently proceeds without evidence.
 const claimed=await db.query(`WITH moved AS (
  UPDATE github_pr_comment_executions
  SET state='in_flight',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2 AND state='reserved'
  RETURNING idempotency_key
 ), evidence AS (
  INSERT INTO brain_events(event_type,details)
  SELECT 'github-pr-comment-stage',
   jsonb_build_object('idempotencyKey',idempotency_key,
    'stage','provider_write_intent','reason',NULL::text)
  FROM moved RETURNING id
 ) SELECT (SELECT count(*)::int FROM moved) AS claims,
  (SELECT count(*)::int FROM evidence) AS events`,[prepared.idempotencyKey,digest]);
 if(claimed?.rows?.[0]?.claims!==1||claimed?.rows?.[0]?.events!==1)
  fail('dispatch-not-admitted');
 try{
  const response=await provider(fetchImpl,
   `${API}/repos/${REPO}/issues/${prepared.pullRequest}/comments`,{
    method:'POST',headers:{Authorization:'Bearer '+token,
     Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
     'Content-Type':'application/json'},body:JSON.stringify({body:prepared.commentBody})});
  if(response.status!==201)fail('provider-write-denied');
  let created;try{created=await response.json();}catch{fail('provider-outcome-unknown');}
  if(!verifiedComment(created,prepared))fail('provider-response-mismatch');
  await recordPrCommentStage(db,prepared,'provider_acknowledged');
  const observed=await independentRead(fetchImpl,Number(created.id),prepared,token);
  await recordPrCommentStage(db,prepared,'remote_observed');
  return complete(db,prepared,digest,observed,'success');
 }catch(error){
  await markReconcile(db,prepared);
  // Failure to append a secondary diagnostic must never trigger a second POST.
  try{await recordPrCommentStage(db,prepared,'reconcile_required',
   classifyPrCommentFailure(error).reason);}catch{}
  throw error;
 }
}
export async function reconcilePrCommentCanary({
 db,prepared,operationDigest:digest,appCredentials,fetchImpl=globalThis.fetch,
 clock=Date.now
}={}){
 prepared=validatePreparedCanary(prepared);
 if(typeof db?.query!=='function'||!SHA256.test(digest||'')||
   typeof fetchImpl!=='function'||typeof clock!=='function')fail('service-invalid');
 const stored=await row(db,prepared.idempotencyKey);
 if(stored.operation_digest!==digest||databaseId(stored.target_number)!==prepared.pullRequest||
   stored.body_sha256!==prepared.bodySha256)fail('intent-conflict');
 if(stored.state==='completed')return Object.freeze({status:'recovered_success',receipt:stored.receipt});
 if(!['in_flight','reconcile_required'].includes(stored.state))fail('reconciliation-not-admitted');
 await recordPrCommentStage(db,prepared,'reconciliation_started');
 const token=appCredentials?await tokenForComment(appCredentials,fetchImpl,clock):'';
 // The per-issue comments endpoint ignores sort/direction and returns oldest
 // first, so bound the scan to comments created after the reservation.
 const reservedAt=Date.parse(stored.created_at instanceof Date?
  stored.created_at.toISOString():String(stored.created_at||''));
 const since=Number.isFinite(reservedAt)?
  '&since='+encodeURIComponent(new Date(reservedAt-60000).toISOString()):'';
 const matches=[];
 for(let page=1;page<=5;page++){
  const response=await provider(fetchImpl,
   `${API}/repos/${REPO}/issues/${prepared.pullRequest}/comments?per_page=100&page=${page}${since}`,{
    headers:readHeaders(token)});
  if(response.status!==200)fail('readback-unavailable');
  let comments;try{comments=await response.json();}catch{fail('readback-unavailable');}
  if(!Array.isArray(comments))fail('readback-unavailable');
  matches.push(...comments.filter(comment=>verifiedComment(comment,prepared)));
  if(comments.length<100)break;
 }
 if(matches.length!==1){
  await markReconcile(db,prepared);
  await recordPrCommentStage(db,prepared,'reconciliation_unresolved',
   matches.length?'readback-conflict':'readback-not-found');
  fail(matches.length?'readback-conflict':'readback-not-found');
 }
 const observed=await independentRead(fetchImpl,Number(matches[0].id),prepared,token);
 await recordPrCommentStage(db,prepared,'remote_observed');
 return complete(db,prepared,digest,observed,'reconciled_success');
}
