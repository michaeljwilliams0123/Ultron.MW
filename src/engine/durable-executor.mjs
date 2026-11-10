/**
 * Task 4: fail-closed, PostgreSQL-backed GitHub branch mutation executor.
 *
 * A Task 2 trusted authorization verifier MUST be wired in by the caller.
 * Branch existence is not success: the HEAD commit must contain an exact,
 * operation-bound trailer. Ambiguous writes are never automatically replayed.
 */
import {ULTRON_REPOSITORY} from '../github-principal-policy.mjs';

const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const TASK_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/;
const ROLES=new Set(['builder','skeptic','steward','predictor','generator','sentinel','companion']);
const STATES=new Set(['reserved','in_flight','reconcile_required','completed']);
const FIELDS=`idempotency_key AS "idempotencyKey", operation_digest AS "operationDigest",
 repository, target_branch AS "targetBranch", persona_role AS "personaRole",
 state, receipt`;

function fail(message){throw Error(`durable-executor-${message}`);}
function dataField(value,field){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid-context');
 const descriptor=Object.getOwnPropertyDescriptor(value,field);
 if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('invalid-context');
 return descriptor.value;
}
function validateContext(context,persona){
 const taskId=dataField(context,'taskId');
 const targetBranch=dataField(context,'targetBranch');
 const operationDigest=dataField(context,'operationDigest');
 const sourceSha=Object.hasOwn(context||{},'sourceSha')?dataField(context,'sourceSha'):null;
 const repository=Object.hasOwn(context||{},'repository')?dataField(context,'repository'):ULTRON_REPOSITORY;
 const personaRole=dataField(persona,'role');
 if(typeof taskId!=='string'||!TASK_ID.test(taskId)||
  typeof targetBranch!=='string'||targetBranch.length>120||
  !/^(?:canary|ultron|feature)\/[a-z0-9][a-z0-9._/-]+$/i.test(targetBranch)||
  targetBranch.includes('..')||targetBranch.includes('//')||targetBranch.endsWith('/')||
  targetBranch.endsWith('.')||targetBranch.endsWith('.lock')||
  !SHA64.test(operationDigest)||
  (sourceSha!==null&&!SHA40.test(sourceSha))||
  (targetBranch.startsWith('ultron/canary-')&&!sourceSha)||
  repository!==ULTRON_REPOSITORY||
  !ROLES.has(personaRole))fail('invalid-context');
 return Object.freeze({idempotencyKey:`ultron-task-${taskId}`,taskId,
  repository,targetBranch,operationDigest,personaRole,
  ...(sourceSha?{sourceSha}:{})});
}
function matches(row,intent){
 return row&&row.idempotencyKey===intent.idempotencyKey&&
  row.operationDigest===intent.operationDigest&&row.repository===intent.repository&&
  row.targetBranch===intent.targetBranch&&row.personaRole===intent.personaRole&&
  STATES.has(row.state);
}
async function read(db,key){
 const result=await db.query(`SELECT ${FIELDS} FROM github_idempotent_executions WHERE idempotency_key=$1`,[key]);
 if(!Array.isArray(result?.rows)||result.rows.length>1)fail('ledger-readback-unavailable');
 return result.rows[0]??null;
}
async function reserve(db,intent){
 const r=await db.query(`INSERT INTO github_idempotent_executions
  (idempotency_key,operation_digest,repository,target_branch,persona_role,state)
  VALUES ($1,$2,$3,$4,$5,'reserved') ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING ${FIELDS}`,
 [intent.idempotencyKey,intent.operationDigest,intent.repository,intent.targetBranch,intent.personaRole]);
 if(!Array.isArray(r?.rows))fail('ledger-claim-unavailable');
 const row=await read(db,intent.idempotencyKey);
 if(!matches(row,intent))fail('intent-conflict');
 return {created:r.rows.length===1,row};
}
function validatedReceipt(row,intent){
 const receipt=row?.receipt;
 if(row?.state!=='completed'||!receipt||
  receipt.idempotencyKey!==intent.idempotencyKey||
  receipt.details?.operationDigest!==intent.operationDigest||
  receipt.details?.branch!==intent.targetBranch||
  receipt.details?.repository!==intent.repository||
  receipt.details?.personaRole!==intent.personaRole||
  receipt.details?.remoteVerified!==true||
  !SHA40.test(receipt.details?.sha||'')||
  !['success','reconciled_success','recovered_success'].includes(receipt.status))
  fail('receipt-invalid');
 return receipt;
}
function receiptFor(intent,status,sha,now){
 return {idempotencyKey:intent.idempotencyKey,status,
  details:{repository:intent.repository,branch:intent.targetBranch,
   operationDigest:intent.operationDigest,sha,remoteVerified:true,
   personaRole:intent.personaRole},timestamp:new Date(now).toISOString()};
}
async function complete(db,intent,status,sha,now){
 const receipt=receiptFor(intent,status,sha,now);
 try{
  await db.query(`UPDATE github_idempotent_executions
   SET state='completed',receipt=$3::jsonb,updated_at=now()
   WHERE idempotency_key=$1 AND operation_digest=$2
     AND state IN ('reserved','in_flight','reconcile_required') RETURNING idempotency_key`,
  [intent.idempotencyKey,intent.operationDigest,JSON.stringify(receipt)]);
 }catch{ /* An acknowledged or lost-ACK update must be checked by a new SELECT. */ }
 let row;
 try{row=await read(db,intent.idempotencyKey);}catch{fail('receipt-persistence-unverified');}
 if(!matches(row,intent))fail('intent-conflict');
 if(row.state!=='completed')fail('receipt-persistence-unverified');
 return validatedReceipt(row,intent);
}
async function hold(db,intent,reason){
 try{
  await db.query(`UPDATE github_idempotent_executions
   SET state='reconcile_required',updated_at=now()
   WHERE idempotency_key=$1 AND operation_digest=$2
     AND state IN ('reserved','in_flight')`,[intent.idempotencyKey,intent.operationDigest]);
 }catch{ /* Lost ACK may still mean the guarded SQL update committed. */ }
 let row;
 try{row=await read(db,intent.idempotencyKey);}
 catch{fail('reconciliation-persistence-unverified');}
 if(!matches(row,intent))fail('intent-conflict');
 if(row.state==='completed')return validatedReceipt(row,intent);
 if(row.state!=='reconcile_required')fail('reconciliation-persistence-unverified');
 return {idempotencyKey:intent.idempotencyKey,status:'reconcile_required',
  details:{branch:intent.targetBranch,reason,remoteVerified:false}};
}
function requireServices(services){
 if(typeof services?.db?.query!=='function'||typeof services?.authorization?.verify!=='function')
  fail('trusted-adapters-required');
 if(services?.remote!==undefined&&typeof services.remote?.inspect!=='function')
  fail('trusted-adapters-required');
 if(services?.clock!==undefined&&typeof services.clock!=='function')
  fail('trusted-adapters-required');
}
async function verifyAuthorization(services,intent){
 // An untrusted `authorized:true` flag is never proof. Task 2 supplies this
 // trusted verification adapter, including nonce/revocation and scope checks.
 const proof=await services.authorization.verify(intent);
 const now=(services.clock??Date.now)();
 if(!Number.isFinite(now))fail('clock-invalid');
 if(proof?.verified!==true||proof?.operationDigest!==intent.operationDigest||
  proof?.repository!==intent.repository||proof?.targetBranch!==intent.targetBranch||
  proof?.personaRole!==intent.personaRole||
  typeof proof.expiresAt!=='string'||!Number.isFinite(Date.parse(proof.expiresAt))||
  Date.parse(proof.expiresAt)<=now)fail('authorization-rejected');
}
const trailer=digest=>`Ultron-Operation-Digest: ${digest}`;

/** Independent GitHub readback: 404 on the ref means absent; 401/403/5xx are not absence. */
export async function inspectGitHubBranch(token,intent,{fetchImpl=globalThis.fetch}={}){
 if(typeof token!=='string'||token.length<8||typeof fetchImpl!=='function')
  fail('github-transport-unavailable');
 const base=`https://api.github.com/repos/${ULTRON_REPOSITORY}`;
 const get=async path=>{
  const response=await fetchImpl(base+path,{headers:{Accept:'application/vnd.github+json',
   Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'}});
  if(response.status===404)return null;
  if(!response.ok)fail('github-readback-unavailable');
  return response.json();
 };
 const path=`/git/ref/heads/${intent.targetBranch.split('/').map(encodeURIComponent).join('/')}`;
 const ref=await get(path);
 if(!ref)return {state:'absent'};
 const sha=ref?.object?.sha;
 if(ref.object?.type!=='commit'||!SHA40.test(sha||''))
  return {state:'conflict'};
 const commit=await get(`/git/commits/${sha}`);
 // A deleted/changed commit ref is uncertain, not an absent branch.
 if(!commit||typeof commit.message!=='string')fail('github-readback-unavailable');
 const matching=commit.message.split(/\r?\n/).some(line=>line===trailer(intent.operationDigest));
 if(!matching)return {state:'conflict',sha};
 // Canary receipts must prove ancestry and identical content before becoming
 // immutable in PostgreSQL; a digest marker alone is insufficient.
 if(intent.sourceSha){
  if(commit.parents?.length!==1||commit.parents[0]?.sha!==intent.sourceSha||
     !SHA40.test(commit.tree?.sha||''))return {state:'conflict',sha};
  const parent=await get('/git/commits/'+intent.sourceSha);
  if(parent?.sha!==intent.sourceSha||parent.tree?.sha!==commit.tree.sha)
   return {state:'conflict',sha};
 }
 // The branch can advance during the commit lookup. Never attest a stale HEAD.
 const freshRef=await get(path);
 if(freshRef?.object?.type!=='commit'||freshRef.object.sha!==sha)
  return {state:'conflict',sha};
 return {state:'matched',sha};
}

/**
 * `gitOperation` must create a commit whose message includes operationMarker.
 * Return status is provider readback + durable SELECT, never callback success.
 */
export async function executeIdempotentGitHubWrite(taskContext,token,persona,gitOperation,services={}){
 requireServices(services);
 if(typeof gitOperation!=='function'||typeof token!=='string'||token.length<8)
  fail('invalid-operation');
 const intent=validateContext(taskContext,persona);
 // A mutable caller-supplied authorName must not impersonate another role.
 const label=intent.personaRole[0].toUpperCase()+intent.personaRole.slice(1);
 const safePersona=Object.freeze({
  role:intent.personaRole,
  authorName:`Ultron.MW [${label}]`,
  // Derive a fixed attribution address; never propagate caller-controlled
  // authorEmail, even if the supplied persona claims a privileged identity.
  authorEmail:`ultron-mw-${intent.personaRole}@system.local`
 });
 const db=services.db;
 const inspect=()=>services.remote?.inspect
  ?services.remote.inspect({token,intent})
  :inspectGitHubBranch(token,intent,{fetchImpl:services.fetchImpl});
 await verifyAuthorization(services,intent);
 const claim=await reserve(db,intent);
 if(claim.row.state==='completed')return validatedReceipt(claim.row,intent);
 let remote;
 try{remote=await inspect();}
 catch{return hold(db,intent,'remote-readback-unavailable');}
 if(remote?.state==='matched'&&SHA40.test(remote.sha||''))
  return complete(db,intent,claim.created?'reconciled_success':'recovered_success',
   remote.sha,(services.clock??Date.now)());
 if(remote?.state==='conflict')return hold(db,intent,'remote-branch-mismatch');
 if(remote?.state!=='absent')return hold(db,intent,'remote-readback-unavailable');
 // A duplicate/resumed claim is NOT a fresh right to replay an uncertain write.
 if(!claim.created){
  // A concurrent observer cannot steal a reserved claim from its worker.
  if(claim.row.state==='reserved')return {idempotencyKey:intent.idempotencyKey,
   status:'reconcile_required',details:{branch:intent.targetBranch,
    reason:'prior-attempt-in-progress',remoteVerified:false}};
  return hold(db,intent,'prior-attempt-uncertain');
 }
 await verifyAuthorization(services,intent);
 const dispatch=await db.query(`UPDATE github_idempotent_executions
  SET state='in_flight',updated_at=now()
  WHERE idempotency_key=$1 AND operation_digest=$2 AND state='reserved'
  RETURNING idempotency_key`,[intent.idempotencyKey,intent.operationDigest]);
 if(dispatch?.rows?.length!==1)return hold(db,intent,'dispatch-claim-lost');
 try{
  await gitOperation({token,persona:safePersona,targetBranch:intent.targetBranch,
   idempotencyKey:intent.idempotencyKey,operationDigest:intent.operationDigest,
   operationMarker:trailer(intent.operationDigest)});
 }catch{/* The external side effect might have committed before an error/timeout. */}
 try{remote=await inspect();}
 catch{return hold(db,intent,'remote-readback-unavailable');}
 if(remote?.state==='matched'&&SHA40.test(remote.sha||''))
  return complete(db,intent,'success',remote.sha,(services.clock??Date.now)());
 return hold(db,intent,remote?.state==='conflict'?'remote-branch-mismatch':'outcome-unverified');
}