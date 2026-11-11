import {createHash,createSign,randomBytes} from 'node:crypto';

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

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
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
 const idempotencyKey=`ultron-task-c04-pr${pullRequest}-${randomBytes(12).toString('hex')}`;
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
async function tokenForComment(raw,fetchImpl,clock){
 const c=credentials(raw),now=clock(),seconds=Math.floor(now/1000);
 if(!Number.isSafeInteger(now)||seconds<1)fail('clock-invalid');
 const unsigned=json({alg:'RS256',typ:'JWT'})+'.'+
  json({iat:seconds-30,exp:seconds+540,iss:String(c.appId)});
 let jwt;
 try{jwt=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end()
  .sign(c.privateKey).toString('base64url');}
 catch{fail('configuration-invalid');}
 const permissions={issues:'write',metadata:'read'};
 const response=await provider(fetchImpl,
  `${API}/app/installations/${c.installationId}/access_tokens`,{
   method:'POST',headers:{Authorization:'Bearer '+jwt,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
    'Content-Type':'application/json'},
   body:JSON.stringify({repository_ids:[REPO_ID],permissions})});
 if(response.status!==201)fail('token-exchange-denied');
 let body;
 try{body=await response.json();}catch{fail('token-response-invalid');}
 if(typeof body?.token!=='string'||!body.token||
   body.permissions?.issues!=='write'||body.permissions?.metadata!=='read'||
   Object.keys(body.permissions).length!==2||!Array.isArray(body.repositories)||
   body.repositories.length!==1||body.repositories[0]?.id!==REPO_ID||
   body.repositories[0]?.full_name!==REPO||
   !(Date.parse(body.expires_at)>now&&Date.parse(body.expires_at)<=now+3600000))
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
async function independentRead(fetchImpl,id,prepared){
 const response=await provider(fetchImpl,`${API}/repos/${REPO}/issues/comments/${id}`,{
  headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});
 if(response.status!==200)fail('readback-unavailable');
 let body;try{body=await response.json();}catch{fail('readback-unavailable');}
 if(!verifiedComment(body,prepared))fail('readback-mismatch');
 return body;
}
async function row(db,key){
 const result=await db.query(`SELECT idempotency_key,state,operation_digest,
  target_number,body_sha256,grant_id,created_at,receipt
  FROM github_idempotent_executions WHERE idempotency_key=$1`,[key]);
 if(result?.rows?.length!==1)fail('ledger-readback-unavailable');
 return result.rows[0];
}
async function markReconcile(db,prepared){
 try{await db.query(`UPDATE github_idempotent_executions
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
 try{await db.query(`UPDATE github_idempotent_executions SET
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
 const token=await tokenForComment(appCredentials,fetchImpl,clock);
 const claimed=await db.query(`UPDATE github_idempotent_executions
  SET state='in_flight',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2 AND state='reserved'
  RETURNING idempotency_key`,[prepared.idempotencyKey,digest]);
 if(claimed?.rows?.length!==1)fail('dispatch-not-admitted');
 try{
  const response=await provider(fetchImpl,
   `${API}/repos/${REPO}/issues/${prepared.pullRequest}/comments`,{
    method:'POST',headers:{Authorization:'Bearer '+token,
     Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
     'Content-Type':'application/json'},body:JSON.stringify({body:prepared.commentBody})});
  if(response.status!==201)fail('provider-write-denied');
  let created;try{created=await response.json();}catch{fail('provider-outcome-unknown');}
  if(!verifiedComment(created,prepared))fail('provider-response-mismatch');
  const observed=await independentRead(fetchImpl,Number(created.id),prepared);
  return complete(db,prepared,digest,observed,'success');
 }catch(error){
  await markReconcile(db,prepared);
  throw error;
 }
}
export async function reconcilePrCommentCanary({
 db,prepared,operationDigest:digest,fetchImpl=globalThis.fetch
}={}){
 prepared=validatePreparedCanary(prepared);
 if(typeof db?.query!=='function'||!SHA256.test(digest||'')||
   typeof fetchImpl!=='function')fail('service-invalid');
 const stored=await row(db,prepared.idempotencyKey);
 if(stored.operation_digest!==digest||databaseId(stored.target_number)!==prepared.pullRequest||
   stored.body_sha256!==prepared.bodySha256)fail('intent-conflict');
 if(stored.state==='completed')return Object.freeze({status:'recovered_success',receipt:stored.receipt});
 if(!['in_flight','reconcile_required'].includes(stored.state))fail('reconciliation-not-admitted');
 const matches=[];
 for(let page=1;page<=5;page++){
  const response=await provider(fetchImpl,
   `${API}/repos/${REPO}/issues/${prepared.pullRequest}/comments?per_page=100&page=${page}&sort=created&direction=desc`,{
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});
  if(response.status!==200)fail('readback-unavailable');
  let comments;try{comments=await response.json();}catch{fail('readback-unavailable');}
  if(!Array.isArray(comments))fail('readback-unavailable');
  matches.push(...comments.filter(comment=>verifiedComment(comment,prepared)));
  if(comments.length<100)break;
 }
 if(matches.length!==1){await markReconcile(db,prepared);fail(matches.length
  ?'readback-conflict':'readback-not-found');}
 const observed=await independentRead(fetchImpl,Number(matches[0].id),prepared);
 return complete(db,prepared,digest,observed,'reconciled_success');
}
