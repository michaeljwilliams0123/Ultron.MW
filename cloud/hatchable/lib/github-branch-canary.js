/**
 * #412 Option A: owner-signed, grant-bound GitHub branch canary for Hatchable.
 * Composes the verbatim master pipeline (lib/master-pipeline.js) with
 * Hatchable-native adapters: adjudicator grant + atomic 0037/0039/0044
 * reservation (Task 2), prepare-only dispatch (Task 3), a durable executor that
 * consults authorization.verify before and after its claim (Task 4), and a
 * brain_events audit with an independent provider readback (Task 5).
 * $0 spend, no model invocation, no fs/git, and no automatic provider retry.
 */
import {createHash,createSign,randomBytes} from 'node:crypto';
import {runMasterPipeline,createCanaryCommitOperation,createCanaryLineageVerifier}
 from 'lib/master-pipeline.js';
import {verifyDelegatedGrant,reserveBranchExecution,isVerifiedBranchGrant}
 from 'lib/security-adjudicator.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const APP_ID=5633654;
const INSTALLATION_ID=179066535;
const API='https://api.github.com';
const OPERATION='repair.branch.create';
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const TASK=/^hb-[a-f0-9]{24}$/;
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const OBJECTIVE='Owner-signed Hatchable branch canary (#412): one branch at the '+
 'signed source tree, $0 paid inference, independent readback, no automatic retry.';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const POLICY_SHA=hash('ultron.412.owner-signed-hatchable-branch-canary.v1');
const ACTOR='worker:builder';
const PERSONA=Object.freeze({role:'Builder',authorName:'Ultron.MW [Builder]',
 authorEmail:'ultron-mw-builder@system.local'});
const SAFE_PERSONA=Object.freeze({role:'builder',authorName:PERSONA.authorName,
 authorEmail:PERSONA.authorEmail});
const WRITE={contents:'write',metadata:'read'};
const READ={contents:'read',metadata:'read'};

function fail(message){throw Error('github-branch-canary-'+message);}
// A classified, response-safe outcome carried through the pipeline.
function outcome(http,error,status){
 return Object.assign(Error('github-branch-canary-'+error),{canary:{http,error,status}});
}
function exact(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  Object.keys(value).every(key=>keys.includes(key));
}
function positive(value){
 const text=String(value??'');
 if(!/^[1-9][0-9]*$/.test(text))fail('configuration-invalid');
 const number=Number(text);
 if(!Number.isSafeInteger(number))fail('configuration-invalid');
 return number;
}

export function canonicalBranchPlan({taskId,sourceSha}={}){
 if(!TASK.test(taskId||'')||!SHA40.test(sourceSha||''))fail('request-invalid');
 return {schema:'ultron.github.operation.v1',repository:REPO,operation:OPERATION,
  activeAgentRole:'Builder',idempotencyKey:'repair:'+taskId,
  permittedScope:{operation:OPERATION,repositoryId:REPO_ID,
   permissions:{metadata:'read',contents:'write'}},
  parameters:{taskId,objective:OBJECTIVE,sourceSha,
   branch:'ultron/canary-'+taskId}};
}
const resourceFor=(branch,digest)=>`github:branch:${REPO}:${branch}:sha256:${digest}`;
function preparedFor(taskId,sourceSha){
 const plan=canonicalBranchPlan({taskId,sourceSha});
 return Object.freeze({taskId,sourceSha,branch:plan.parameters.branch,
  planSha256:hash(JSON.stringify(plan))});
}
export function branchGrantRequest(prepared){
 return {actor:ACTOR,objectiveId:'ultron-task-'+prepared.taskId,operation:OPERATION,
  resource:resourceFor(prepared.branch,prepared.planSha256),administrativeChange:false};
}

/** Read-only state check. repair.branch.create is off until the owner selects it. */
export async function prepareBranchCanary({db,sourceSha}={}){
 if(typeof db?.query!=='function'||!SHA40.test(sourceSha||''))fail('request-invalid');
 const state=(await db.query(`SELECT a.version AS profile_version,
  c.version AS stop_version,c.paused,a.max_paid_cents,
  jsonb_exists(a.allowed_operations,'repair.branch.create') AS allowed
  FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'`)).rows?.[0];
 if(!state||state.paused||state.max_paid_cents!==0||state.allowed!==true)
  fail('authority-state-denied');
 const prepared=preparedFor('hb-'+randomBytes(12).toString('hex'),sourceSha);
 const ownerGrantRequest={...branchGrantRequest(prepared),policySha:POLICY_SHA,
  profileVersion:Number(state.profile_version),stopVersion:Number(state.stop_version)};
 return Object.freeze({prepared,plan:canonicalBranchPlan(prepared),
  ownerGrantRequest:Object.freeze(ownerGrantRequest)});
}
export function validatePreparedBranchCanary(value){
 const keys=['taskId','sourceSha','branch','planSha256'];
 if(!exact(value,keys)||!TASK.test(value.taskId||'')||!SHA40.test(value.sourceSha||''))
  fail('request-invalid');
 const expected=preparedFor(value.taskId,value.sourceSha);
 if(keys.some(key=>value[key]!==expected[key]))fail('request-invalid');
 return expected;
}
export function grantIdOf(envelope){
 try{
  const grantId=JSON.parse(envelope?.payload)?.grantId;
  if(typeof grantId!=='string'||!GRANT.test(grantId))throw Error();
  return grantId;
 }catch{fail('envelope-invalid');}
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
 try{return await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),...options});}
 catch{fail('provider-outcome-unknown');}
}
async function installationToken(c,permissions,fetchImpl,clock){
 const now=clock(),seconds=Math.floor(now/1000);
 if(!Number.isSafeInteger(now)||seconds<1)fail('clock-invalid');
 const unsigned=json({alg:'RS256',typ:'JWT'})+'.'+
  json({iat:seconds-30,exp:seconds+540,iss:String(c.appId)});
 let jwt;
 try{jwt=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end()
  .sign(c.privateKey).toString('base64url');}
 catch{fail('configuration-invalid');}
 const response=await provider(fetchImpl,
  `${API}/app/installations/${c.installationId}/access_tokens`,{
   method:'POST',headers:{Authorization:'Bearer '+jwt,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json'},
   body:JSON.stringify({repository_ids:[REPO_ID],permissions})});
 if(response?.status!==201)fail('token-exchange-denied');
 let body;
 try{body=await response.json();}catch{fail('token-response-invalid');}
 const granted=body?.permissions;
 if(typeof body?.token!=='string'||body.token.length<8||!exact(granted,Object.keys(permissions))||
   Object.entries(permissions).some(([key,value])=>granted[key]!==value)||
   !Array.isArray(body.repositories)||body.repositories.length!==1||
   body.repositories[0]?.id!==REPO_ID||body.repositories[0]?.full_name!==REPO||
   !(Date.parse(body.expires_at)>now&&Date.parse(body.expires_at)<=now+3600000))
  fail('token-response-invalid');
 return body.token;
}
/** Task 1 equivalent: pinned App installation, exact repository + permissions. */
export function createBranchIdentity({appCredentials,fetchImpl=globalThis.fetch,
 clock=Date.now}={}){
 const c=credentials(appCredentials);
 if(typeof fetchImpl!=='function'||typeof clock!=='function')fail('service-invalid');
 return Object.freeze({installationId:INSTALLATION_ID,
  getTokenForScope:async scope=>{
   if(scope!==OPERATION)fail('scope-denied');
   return installationToken(c,WRITE,fetchImpl,clock);
  },
  getReadToken:()=>installationToken(c,READ,fetchImpl,clock)});
}

const VERIFY_SQL=`SELECT e.idempotency_key,e.operation_digest,e.repository,
 e.target_branch,e.persona_role,e.state,e.grant_id,g.operation,g.resource,g.expires_at,
 EXISTS(SELECT 1 FROM brain_owner_autonomy_profile a
  JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'
   AND a.preset IN ('build','release') AND a.version=$2 AND c.version=$3
   AND NOT c.paused AND a.max_paid_cents=0
   AND jsonb_exists(a.allowed_operations,'repair.branch.create')
   AND EXISTS(SELECT 1 FROM brain_owner_passkeys WHERE revoked_at IS NULL)
 ) AS authority_live
 FROM github_idempotent_executions e
 JOIN brain_authority_grants g ON g.grant_id=e.grant_id
 WHERE e.idempotency_key=$1 AND e.target_kind='branch'`;
/**
 * durableServices.authorization adapter. Proof is derived only from the
 * module-verified grant and its durable reservation, re-read on every call,
 * so a stop, profile change, revocation or expiry after reservation denies.
 */
export function createBranchAuthorizationVerifier({db,verifiedGrant,clock=Date.now}={}){
 if(typeof db?.query!=='function'||typeof clock!=='function')fail('service-invalid');
 return Object.freeze({async verify(intent){
  const grant=typeof verifiedGrant==='function'?verifiedGrant():verifiedGrant;
  if(!isVerifiedBranchGrant(grant)||!intent||typeof intent!=='object'||
    intent.repository!==REPO||intent.personaRole!=='builder'||
    !SHA256.test(intent.operationDigest||'')||
    typeof intent.idempotencyKey!=='string'||typeof intent.targetBranch!=='string')
   fail('authorization-rejected');
  let rows;
  try{rows=(await db.query(VERIFY_SQL,[intent.idempotencyKey,
   grant.profileVersion,grant.stopVersion]))?.rows;}
  catch{fail('authorization-unavailable');}
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  const expires=row?new Date(row.expires_at).getTime():NaN;
  const now=clock();
  if(!row||row.grant_id!==grant.grantId||row.operation!==OPERATION||
    row.resource!==grant.resource||
    row.resource!==resourceFor(intent.targetBranch,intent.operationDigest)||
    row.operation_digest!==intent.operationDigest||row.repository!==intent.repository||
    row.target_branch!==intent.targetBranch||row.persona_role!==intent.personaRole||
    !['reserved','in_flight'].includes(row.state)||row.authority_live!==true||
    !Number.isFinite(expires)||expires!==Date.parse(grant.expiresAt)||
    !Number.isFinite(now)||expires<=now)
   fail('authorization-rejected');
  return Object.freeze({verified:true,operationDigest:row.operation_digest,
   repository:row.repository,targetBranch:row.target_branch,
   personaRole:row.persona_role,expiresAt:new Date(expires).toISOString()});
 }});
}
// Same proof contract src/engine/durable-executor.mjs applies.
async function requireAuthorization(services,intent,clock){
 const proof=await services.authorization.verify(intent);
 const now=clock();
 if(proof?.verified!==true||proof?.operationDigest!==intent.operationDigest||
  proof?.repository!==intent.repository||proof?.targetBranch!==intent.targetBranch||
  proof?.personaRole!==intent.personaRole||typeof proof.expiresAt!=='string'||
  !Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=now)
  fail('authorization-rejected');
}

const ROW_SQL=`SELECT idempotency_key,state,operation_digest,repository,target_branch,
 persona_role,grant_id,receipt FROM github_idempotent_executions
 WHERE idempotency_key=$1 AND target_kind='branch'`;
async function row(db,key){
 let result;
 try{result=await db.query(ROW_SQL,[key]);}catch{fail('ledger-readback-unavailable');}
 if(result?.rows?.length!==1)fail('ledger-readback-unavailable');
 return result.rows[0];
}
async function hold(db,intent){
 try{await db.query(`UPDATE github_idempotent_executions
  SET state='reconcile_required',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2
   AND state IN ('reserved','in_flight')`,[intent.idempotencyKey,intent.operationDigest]);}
 catch{/* A lost acknowledgement is resolved by read-only reconcile. */}
}
async function complete(db,intent,status,sha,now){
 const receipt={idempotencyKey:intent.idempotencyKey,status,
  details:{repository:intent.repository,branch:intent.targetBranch,
   operationDigest:intent.operationDigest,sha,remoteVerified:true,
   personaRole:intent.personaRole},timestamp:new Date(now).toISOString()};
 try{await db.query(`UPDATE github_idempotent_executions
  SET state='completed',receipt=$3::jsonb,updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2
   AND state IN ('in_flight','reconcile_required')`,
 [intent.idempotencyKey,intent.operationDigest,JSON.stringify(receipt)]);}catch{}
 const stored=await row(db,intent.idempotencyKey);
 const r=stored.receipt;
 if(stored.state!=='completed'||r?.idempotencyKey!==intent.idempotencyKey||
   r.details?.sha!==sha||r.details?.branch!==intent.targetBranch||
   r.details?.operationDigest!==intent.operationDigest||r.details?.remoteVerified!==true)
  fail('receipt-persistence-unverified');
 return r;
}

/**
 * Task 4 for a pre-reserved, grant-bound row: verify -> CAS claim -> verify ->
 * exactly one provider operation -> independent readback -> durable receipt.
 * Any uncertainty after the claim holds the row as reconcile_required.
 */
export async function executeBranchWrite(task,token,persona,gitOperation,services={}){
 if(typeof services?.db?.query!=='function'||
   typeof services?.authorization?.verify!=='function'||
   typeof services?.inspect!=='function')fail('trusted-adapters-required');
 if(typeof gitOperation!=='function'||typeof token!=='string'||token.length<8)
  fail('invalid-operation');
 if(String(persona?.role||'').toLowerCase()!=='builder'||task?.stage!=='prepared'||
   !TASK.test(task.taskId||'')||task.targetBranch!=='ultron/canary-'+task.taskId||
   !SHA40.test(task.sourceSha||'')||!SHA256.test(task.operationDigest||''))
  fail('invalid-context');
 const db=services.db,clock=services.clock??Date.now;
 const intent=Object.freeze({idempotencyKey:'ultron-task-'+task.taskId,
  operationDigest:task.operationDigest,repository:REPO,
  targetBranch:task.targetBranch,personaRole:'builder',sourceSha:task.sourceSha});
 await requireAuthorization(services,intent,clock);
 let claimed;
 try{claimed=await db.query(`UPDATE github_idempotent_executions
  SET state='in_flight',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2 AND target_branch=$3
   AND state='reserved' RETURNING idempotency_key`,
 [intent.idempotencyKey,intent.operationDigest,intent.targetBranch]);}
 catch{services.onPhase?.('dispatched');await hold(db,intent);fail('dispatch-claim-uncertain');}
 if(claimed?.rows?.length!==1)fail('dispatch-not-admitted');
 services.onPhase?.('dispatched');
 // Re-check immediately before the external mutation (stop/expiry may change).
 try{await requireAuthorization(services,intent,clock);}
 catch(error){await hold(db,intent);throw error;}
 let created;
 try{
  created=await gitOperation({token,persona:SAFE_PERSONA,
   targetBranch:intent.targetBranch,idempotencyKey:intent.idempotencyKey,
   operationDigest:intent.operationDigest,
   operationMarker:'Ultron-Operation-Digest: '+intent.operationDigest});
 }catch{await hold(db,intent);fail('provider-outcome-unknown');}
 if(created?.branch!==intent.targetBranch||!SHA40.test(created?.sha||'')){
  await hold(db,intent);fail('provider-response-invalid');}
 try{await services.inspect({token,intent,commitSha:created.sha});}
 catch{await hold(db,intent);fail('readback-mismatch');}
 const receipt=await complete(db,intent,'success',created.sha,clock());
 services.onPhase?.('completed');
 return receipt;
}

/** Task 5 replacement: independent provider readback, then a brain_events audit. */
export function createBranchAuditRecorder({db,readback,sourceSha}={}){
 if(typeof db?.query!=='function'||typeof readback!=='function'||!SHA40.test(sourceSha||''))
  fail('service-invalid');
 return async receipt=>{
  const d=receipt?.details;
  if(!exact(d,['repository','branch','operationDigest','sha','remoteVerified','personaRole'])||
    d.repository!==REPO||d.remoteVerified!==true||!SHA40.test(d.sha||'')||
    !SHA256.test(d.operationDigest||''))fail('audit-receipt-invalid');
  let providerReadbackStatus='matched';
  try{await readback({branch:d.branch,sourceSha,commitSha:d.sha,
   operationDigest:d.operationDigest});}
  catch(error){
   providerReadbackStatus=/lineage-(invalid|scope-invalid)$/.test(String(error?.message))
    ?'mismatch':'unavailable';
  }
  const details={schema:'ultron.task5.local-audit.v1',
   idempotencyKey:receipt.idempotencyKey,executionStatus:receipt.status,
   // Pipeline-level contract: remoteReadbackVerified:false means the pipeline's
   // own Task-5 readback (the src local git-diff audit) is NOT performed on
   // Hatchable. The separate provider readback above is reported only by
   // providerReadbackStatus ('matched' | 'mismatch' | 'unavailable').
   status:'REMOTE_READBACK_REQUIRED',remoteReadbackVerified:false,
   providerReadbackStatus,branch:d.branch,commitSha:d.sha,sourceSha,
   operationDigest:d.operationDigest,
   executionReceiptDigest:hash(JSON.stringify(receipt))};
  if(providerReadbackStatus!=='matched'){
   // Record the held audit for the operator, then fail closed.
   try{await db.query(`INSERT INTO brain_events(event_type,details)
    VALUES('github-branch-canary-audit-held',$1::jsonb)`,[JSON.stringify(details)]);}
   catch{/* The thrown hold below is authoritative. */}
   fail('audit-readback-'+providerReadbackStatus);
  }
  const auditSha256=hash(JSON.stringify(details));
  let inserted;
  try{inserted=await db.query(`INSERT INTO brain_events(event_type,details)
   VALUES('github-branch-canary-audited',$1::jsonb) RETURNING id`,
  [JSON.stringify({...details,auditSha256})]);}
  catch{fail('audit-persistence-unverified');}
  if(inserted?.rows?.length!==1)fail('audit-persistence-unverified');
  return Object.freeze({...details,auditSha256,receiptId:inserted.rows[0].id});
 };
}

function prepareOnlyDispatcher(){
 const dispatch=async(objective,options)=>{
  if(objective!==OBJECTIVE||!exact(options,['taskId','targetBranch','sourceSha',
    'operationDigest','requiresResponse','enforceSignedApproval','prepareOnly'])||
    options.prepareOnly!==true||options.requiresResponse!==true||
    options.enforceSignedApproval!==true)fail('dispatch-invalid');
  return Object.freeze({stage:'prepared',taskId:options.taskId,
   targetBranch:options.targetBranch,sourceSha:options.sourceSha,
   operationDigest:options.operationDigest});
 };
 Object.defineProperty(dispatch,'supportsPrepareOnly',{value:true});
 return dispatch;
}
function lineageReadback(fetchImpl,getToken){
 const verify=createCanaryLineageVerifier({fetchImpl});
 return async({branch,sourceSha,commitSha,operationDigest})=>
  verify({token:await getToken(),branch,sourceSha,commitSha,operationDigest});
}

/** Submit: run the verbatim master pipeline with Hatchable-native adapters. */
export async function runBranchCanary({db,prepared,envelope,publicJwk,appCredentials,
 fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(typeof db?.query!=='function'||typeof fetchImpl!=='function'||
   typeof clock!=='function')fail('service-invalid');
 prepared=validatePreparedBranchCanary(prepared);
 const grantId=grantIdOf(envelope);
 const identity=createBranchIdentity({appCredentials,fetchImpl,clock});
 const plan=canonicalBranchPlan(prepared);
 const idempotencyKey='ultron-task-'+prepared.taskId;
 const state={phase:'admission',verifiedGrant:null};
 const operationRequest={payload:plan,signedGrant:{nonce:grantId,envelope},
  nonce:grantId,signature:String(envelope?.signature??''),activeAgentRole:'Builder'};
 const approve=async(request,client,trusted)=>{
  if(JSON.stringify(request?.payload)!==JSON.stringify(plan)||request.nonce!==grantId)
   throw outcome(400,'canary-request-invalid');
  let verified;
  try{verified=await verifyDelegatedGrant({envelope,publicJwk:trusted.publicJwk,
   request:branchGrantRequest(prepared),now:new Date(clock()).toISOString()});}
  catch{throw outcome(403,'authority-not-verified');}
  if(verified.grantId!==grantId)throw outcome(403,'authority-not-verified');
  let reservation;
  try{reservation=await reserveBranchExecution({db,verifiedGrant:verified,
   idempotencyKey,targetBranch:prepared.branch,operationDigest:prepared.planSha256});}
  catch{throw outcome(503,'canary-reservation-unavailable');}
  if(!reservation.ok)throw outcome(
   reservation.error==='execution-already-reserved'?409:403,reservation.error,
   reservation.status);
  state.verifiedGrant=verified;state.phase='reserved';
  const token=await client.getTokenForScope(OPERATION);
  return Object.freeze({authorized:true,token,executionPayload:plan,persona:PERSONA});
 };
 const lineage=createCanaryLineageVerifier({fetchImpl});
 try{
  const result=await runMasterPipeline(operationRequest,{
   createVerifiedGitHubClient:async()=>identity,
   enforceSignedApprovalAndTagPersona:approve,
   dispatchHeadlessTask:prepareOnlyDispatcher(),
   executeIdempotentGitHubWrite:(task,token,persona,operation,services)=>
    executeBranchWrite(task,token,persona,operation,{...services,clock,
     onPhase:phase=>{state.phase=phase;},
     inspect:({token:t,intent,commitSha})=>lineage({token:t,branch:intent.targetBranch,
      sourceSha:intent.sourceSha,commitSha,operationDigest:intent.operationDigest})}),
   verifyPostConditionsAndStoreReceipt:createBranchAuditRecorder({db,
    sourceSha:prepared.sourceSha,
    readback:lineageReadback(fetchImpl,()=>identity.getReadToken())}),
   gitOperation:createCanaryCommitOperation({fetchImpl}),
   verifyRemoteLineage:lineage,
   trustedApproval:{publicJwk},
   durableServices:{db,authorization:createBranchAuthorizationVerifier({db,clock,
    verifiedGrant:()=>state.verifiedGrant})},
  });
  return Object.freeze({ok:true,http:201,status:'success',idempotencyKey,
   branch:result.branch,commitSha:result.commitSha,auditSha256:result.auditSha256,
   remoteReadbackVerified:false,providerReadbackStatus:'matched',
   productionAccepted:false});
 }catch(error){
  if(error?.canary)return Object.freeze({ok:false,http:error.canary.http,
   error:error.canary.error,...(error.canary.status?{status:error.canary.status}:{}),
   idempotencyKey});
  if(state.phase==='reserved')return Object.freeze({ok:false,http:503,
   status:'reserved',error:'canary-dispatch-unavailable',idempotencyKey});
  if(state.phase==='dispatched')return Object.freeze({ok:false,http:202,
   status:'reconcile-required',error:'provider-outcome-unresolved',idempotencyKey});
  if(state.phase==='completed'){
   const held=/audit-readback-(mismatch|unavailable)$/.exec(String(error?.message));
   return Object.freeze({ok:false,http:202,status:'completed-unaudited',
    error:'post-conditions-unverified',idempotencyKey,
    ...(held?{providerReadbackStatus:held[1]}:{})});
  }
  return Object.freeze({ok:false,http:403,error:'authority-not-verified',idempotencyKey});
 }
}

/** Read-only reconciliation. Never POSTs; an absent branch stays unresolved. */
export async function reconcileBranchCanary({db,prepared,grantId,appCredentials,
 fetchImpl=globalThis.fetch,clock=Date.now}={}){
 prepared=validatePreparedBranchCanary(prepared);
 if(typeof db?.query!=='function'||typeof fetchImpl!=='function'||
   typeof clock!=='function'||!GRANT.test(grantId||''))fail('service-invalid');
 const identity=createBranchIdentity({appCredentials,fetchImpl,clock});
 const intent=Object.freeze({idempotencyKey:'ultron-task-'+prepared.taskId,
  operationDigest:prepared.planSha256,repository:REPO,targetBranch:prepared.branch,
  personaRole:'builder',sourceSha:prepared.sourceSha});
 const stored=await row(db,intent.idempotencyKey);
 if(stored.operation_digest!==intent.operationDigest||
   stored.target_branch!==intent.targetBranch||stored.grant_id!==grantId)
  fail('intent-conflict');
 if(stored.state==='completed')
  return Object.freeze({status:'recovered_success',receipt:stored.receipt});
 if(stored.state==='reserved')
  return Object.freeze({status:'reserved',dispatched:false});
 const token=await identity.getReadToken();
 const response=await provider(fetchImpl,`${API}/repos/${REPO}/git/ref/heads/${intent.targetBranch}`,{
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28'}});
 if(response?.status===404){await hold(db,intent);fail('readback-not-found');}
 if(response?.status!==200)fail('readback-unavailable');
 let ref;try{ref=await response.json();}catch{fail('readback-unavailable');}
 const commitSha=ref?.object?.sha;
 if(ref?.object?.type!=='commit'||!SHA40.test(commitSha||'')){
  await hold(db,intent);fail('readback-conflict');}
 const readback=lineageReadback(fetchImpl,async()=>token);
 try{await readback({branch:intent.targetBranch,sourceSha:intent.sourceSha,
  commitSha,operationDigest:intent.operationDigest});}
 catch{await hold(db,intent);fail('readback-conflict');}
 const receipt=await complete(db,intent,'reconciled_success',commitSha,clock());
 const audit=await createBranchAuditRecorder({db,sourceSha:intent.sourceSha,
  readback})(receipt);
 return Object.freeze({status:'reconciled_success',receipt,auditSha256:audit.auditSha256,
  providerReadbackStatus:audit.providerReadbackStatus});
}
