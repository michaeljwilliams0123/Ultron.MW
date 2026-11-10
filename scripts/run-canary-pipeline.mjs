/**
 * Owner-authorized, one-shot GitHub branch canary conductor.
 * This composition root does not mint an approval, impersonate a Council role,
 * change server defaults, or treat a local git diff as a remote write proof.
 */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const REPOSITORY='michaeljwilliams0123/Ultron.MW';
const API='https://api.github.com/repos/'+REPOSITORY;
const SHA=/^[0-9a-f]{40}$/;
const TASK=/^[a-z0-9][a-z0-9-]{7,79}$/;
const BRANCH=/^ultron\/canary-[a-z0-9][a-z0-9-]{2,63}$/;
const STATUS=new Set(['completed','verified']);

function check(value,reason){if(!value)throw Error('canary-'+reason);}
function plainObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function safeRequest(input){
  check(plainObject(input)&&plainObject(input.payload),'request-invalid');
  const plan=input.payload;
  const params=plan.parameters;
  check(plainObject(input.signedGrant)&&
    typeof input.signedGrant.nonce==='string'&&
    input.signedGrant.nonce===input.nonce&&
    typeof input.signature==='string'&&input.signature.length>0,
    'signed-grant-required');
  check(plan.schema==='ultron.github.operation.v1'&&
    plan.repository===REPOSITORY&&plan.operation==='repair.branch.create'&&
    plan.activeAgentRole==='Builder'&&input.activeAgentRole==='Builder'&&
    plainObject(plan.permittedScope)&&plainObject(params),
    'signed-plan-invalid');
  check(Object.keys(params).sort().join(',')===
    'branch,objective,sourceSha,taskId'&&
    TASK.test(params.taskId||'')&&
    plan.idempotencyKey==='repair:'+params.taskId&&
    typeof params.objective==='string'&&params.objective.length>0&&
    params.objective.length<=800&&SHA.test(params.sourceSha||'')&&
    BRANCH.test(params.branch||''),'signed-payload-invalid');
  return {taskId:params.taskId,objective:params.objective,
    sourceSha:params.sourceSha,targetBranch:params.branch};
}

/**
 * Narrow GitHub REST operation. A write is attempted at most once; uncertain
 * outcomes trigger readback-only reconciliation, never another POST.
 */
export function createBranchCanaryOperation({fetchImpl=globalThis.fetch}={}){
  check(typeof fetchImpl==='function','github-client-required');
  return async ({token,persona,targetBranch,sourceSha})=>{
    check(typeof token==='string'&&token.length>0,'token-required');
    check(plainObject(persona)&&typeof persona.authorName==='string'&&
      persona.authorName.length>0,'persona-required');
    check(BRANCH.test(targetBranch||'')&&SHA.test(sourceSha||''),'scope-invalid');
    async function request(method,path,body){
      let response;
      try{
        response=await fetchImpl(API+path,{
          method,redirect:'error',signal:AbortSignal.timeout(15000),
          headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
            'X-GitHub-Api-Version':'2022-11-28',
            ...(body?{'Content-Type':'application/json'}:{})},
          ...(body?{body:JSON.stringify(body)}:{}),
        });
      }catch{throw Error('canary-github-outcome-unknown');}
      if(response.status===404&&method==='GET')return null;
      if(!response.ok)throw Error('canary-github-http-'+response.status);
      if(method!=='GET')return {status:response.status};
      try{return await response.json();}
      catch{throw Error('canary-github-readback-invalid');}
    }
    const targetPath='/git/ref/heads/'+targetBranch;
    const main=await request('GET','/git/ref/heads/main');
    check(main?.object?.type==='commit'&&main.object.sha===sourceSha,
      'source-head-changed');
    const before=await request('GET',targetPath);
    if(before!==null){
      check(before.object?.type==='commit'&&before.object.sha===sourceSha,
        'branch-conflict');
    }else{
      // An unsuccessful or timed-out POST is never blindly retried.
      try{
        await request('POST','/git/refs',{
          ref:'refs/heads/'+targetBranch,sha:sourceSha,
        });
      }catch{
        const observed=await request('GET',targetPath).catch(()=>null);
        check(observed?.object?.type==='commit'&&observed.object.sha===sourceSha,
          'reconcile-required');
      }
    }
    // Separate reads bind the reported effect to GitHub, not the POST response.
    for(let attempt=0;attempt<2;attempt++){
      const observed=await request('GET',targetPath);
      check(observed?.ref==='refs/heads/'+targetBranch&&
        observed.object?.type==='commit'&&observed.object.sha===sourceSha,
        'remote-postcondition-unverified');
    }
    return Object.freeze({branch:targetBranch,sha:sourceSha,
      url:'https://github.com/'+REPOSITORY+'/tree/'+targetBranch,
      commitAuthor:persona.authorName,remoteReadbacks:2});
  };
}

/**
 * The five steps are injectable for contract tests. Live execution loads the
 * trusted implementation modules only after a real input is present.
 */
export async function runMasterPipeline(operationRequest,{
  createVerifiedGitHubClient,enforceSignedApprovalAndTagPersona,
  dispatchHeadlessTask,executeIdempotentGitHubWrite,
  verifyPostConditionsAndStoreReceipt,gitOperation=createBranchCanaryOperation(),
  trustedApproval,
}={}){
  const payload=safeRequest(operationRequest);
  for(const [name,fn] of Object.entries({createVerifiedGitHubClient,
    enforceSignedApprovalAndTagPersona,dispatchHeadlessTask,
    executeIdempotentGitHubWrite,verifyPostConditionsAndStoreReceipt,gitOperation}))
    check(typeof fn==='function','dependency-missing-'+name);
  // Existing Task 3 invokes a graph immediately and ignores prepared context.
  // Refuse that interface BEFORE calling it: an after-the-fact check is unsafe.
  check(dispatchHeadlessTask.supportsPrepareOnly===true,
    'dispatcher-prepare-contract-required');

  const identity=await createVerifiedGitHubClient();
  check(identity&&typeof identity.getTokenForScope==='function'&&
    Number.isSafeInteger(identity.installationId),
    'identity-factory-invalid');
  // Task 1 accepts an operation string; Task 2 requests a full scoped profile.
  // Adapt shapes without widening either authority or issuing a new credential.
  const tokenFactory={getTokenForScope:async scope=>{
    check(plainObject(scope)&&scope.operation==='repair.branch.create',
      'token-scope-mismatch');
    return identity.getTokenForScope(scope.operation);
  }};
  const approved=await enforceSignedApprovalAndTagPersona(
    operationRequest,tokenFactory,trustedApproval);
  check(approved?.authorized===true&&
    typeof approved.token==='string'&&approved.token.length>0&&
    plainObject(approved.executionPayload)&&plainObject(approved.persona),
    'authorization-denied');
  // No caller-supplied task or branch can override the signed scope.
  const signed=approved.executionPayload;
  check(signed.schema===operationRequest.payload.schema&&
    signed.operation==='repair.branch.create'&&
    signed.repository===REPOSITORY&&signed.activeAgentRole==='Builder'&&
    signed.idempotencyKey==='repair:'+payload.taskId,
    'authorization-payload-mismatch');
  for(const [key,value] of Object.entries({taskId:payload.taskId,
    objective:payload.objective,sourceSha:payload.sourceSha,
    branch:payload.targetBranch}))
    check(signed.parameters?.[key]===value,
      'authorization-payload-mismatch');

  const task=await dispatchHeadlessTask(payload.objective,{
    taskId:payload.taskId,targetBranch:payload.targetBranch,
    sourceSha:payload.sourceSha,requiresResponse:true,
    authorized:true,prepareOnly:true,
  });
  check(task?.stage==='prepared'&&task.taskId===payload.taskId&&
    task.targetBranch===payload.targetBranch&&
    task.sourceSha===payload.sourceSha,'dispatcher-context-mismatch');
  // Preserve stable task identity so retries resolve to the same durable key.
  const receipt=await executeIdempotentGitHubWrite(task,approved.token,
    approved.persona,async ({token,persona,targetBranch})=>{
      check(targetBranch===payload.targetBranch,'executor-branch-mismatch');
      return gitOperation({token,persona,targetBranch,sourceSha:payload.sourceSha});
    });
  check(receipt?.idempotencyKey==='ultron-task-'+payload.taskId&&
    STATUS.has(receipt.status)&&receipt.details?.sha===payload.sourceSha&&
    receipt.details?.branch===payload.targetBranch&&
    receipt.details?.remoteReadbacks===2,
    'execution-receipt-unverified');
  const audit=await verifyPostConditionsAndStoreReceipt(receipt);
  check(audit?.idempotencyKey===receipt.idempotencyKey&&
    STATUS.has(audit.status)&&audit.details?.sha===payload.sourceSha&&
    audit.details?.branch===payload.targetBranch,
    'audit-receipt-unverified');
  // Do not print credentials, grant, nonce, or persona-private data.
  return Object.freeze({schema:'ultron.canary-conductor.v1',
    idempotencyKey:receipt.idempotencyKey,status:'verified',
    branch:payload.targetBranch,sourceSha:payload.sourceSha,
    auditPath:audit.auditPath??null});
}

export async function loadLiveDependencies(){
  const [a,b,c,d,e]=await Promise.all([
    import('../src/auth/identity-factory.mjs'),
    import('../src/middleware/enforce-signed-approval.mjs'),
    import('./execute-autonomous-task.mjs'),
    import('../src/engine/durable-executor.mjs'),
    import('./verify-post-conditions.mjs'),
  ]);
  return {createVerifiedGitHubClient:a.createVerifiedGitHubClient,
    enforceSignedApprovalAndTagPersona:b.enforceSignedApprovalAndTagPersona,
    dispatchHeadlessTask:c.dispatchHeadlessTask,
    executeIdempotentGitHubWrite:d.executeIdempotentGitHubWrite,
    verifyPostConditionsAndStoreReceipt:e.verifyPostConditionsAndStoreReceipt};
}

async function main(argv){
  // No mock grant, autogenerated task ID, or insecure auto-approval fallback.
  check(argv.length===2&&argv[0]==='--request','usage--request-FILE');
  const operationRequest=JSON.parse(await readFile(resolve(argv[1]),'utf8'));
  // A standalone CLI has no trusted Postgres nonce ledger and signing-key
  // resolver. The cloud composition root must inject them; never accept them
  // from an untrusted request file or guess a production signer.
  safeRequest(operationRequest);
  throw Error('canary-live-approval-adapter-unconfigured');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(error=>{
    console.error(error instanceof Error&&error.message.startsWith('canary-')
      ?error.message:'canary-pipeline-failed');
    process.exitCode=1;
  });
}
