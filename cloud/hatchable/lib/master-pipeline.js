/** Owner-signed, fail-closed five-stage canary composition root.
 * This never invents an approval, token, commit, receipt, or deployment claim.
 * Importable master pipeline (#167): side-effect free; the CLI entrypoint
 * remains scripts/run-canary-pipeline.mjs.
 * Hatchable copy (#412) of src/engine/master-pipeline.mjs. Only the repository
 * import is inlined and loadLiveDependencies is a throwing stub;
 * test/hatchable-master-pipeline-parity.test.mjs fails on any other drift.
 */
import {createHash} from 'node:crypto';
const ULTRON_REPOSITORY='michaeljwilliams0123/Ultron.MW';

const REPOSITORY=ULTRON_REPOSITORY;
const API='https://api.github.com/repos/'+REPOSITORY;
const SHA=/^[0-9a-f]{40}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const TASK=/^[a-z0-9][a-z0-9-]{7,79}$/;
const BRANCH=/^ultron\/canary-[a-z0-9][a-z0-9-]{2,63}$/;
const SUCCESS=new Set(['success','reconciled_success','recovered_success']);
const auditStatus='REMOTE_READBACK_REQUIRED';

export function check(value,reason){if(!value)throw Error('canary-'+reason);}
function plainObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function safeRequest(input){
  check(plainObject(input)&&plainObject(input.payload),'request-invalid');
  const plan=input.payload,params=plan.parameters;
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
    TASK.test(params.taskId||'')&&plan.idempotencyKey==='repair:'+params.taskId&&
    typeof params.objective==='string'&&params.objective.length>0&&
    params.objective.length<=800&&SHA.test(params.sourceSha||'')&&
    BRANCH.test(params.branch||''),'signed-payload-invalid');
  return {taskId:params.taskId,objective:params.objective,
    sourceSha:params.sourceSha,targetBranch:params.branch};
}

/**
 * Perform one GitHub commit + ref mutation; Task 4 exclusively owns durable
 * reserve, conflict detection and independent provider receipt verification.
 * This callback never repeats either POST after an uncertain response.
 */
export function createCanaryCommitOperation({fetchImpl=globalThis.fetch}={}){
  check(typeof fetchImpl==='function','github-client-required');
  return async ({token,persona,targetBranch,sourceSha,operationDigest,operationMarker})=>{
    check(typeof token==='string'&&token.length>=8,'token-required');
    check(plainObject(persona)&&typeof persona.authorName==='string'&&
      typeof persona.authorEmail==='string','persona-required');
    check(BRANCH.test(targetBranch||'')&&SHA.test(sourceSha||'')&&
      DIGEST.test(operationDigest||'')&&
      operationMarker==='Ultron-Operation-Digest: '+operationDigest,
      'operation-scope-invalid');
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
      try{return await response.json();}
      catch{throw Error('canary-github-response-invalid');}
    }
    const main=await request('GET','/git/ref/heads/main');
    check(main?.object?.type==='commit'&&main.object.sha===sourceSha,
      'source-head-changed');
    const branch=await request('GET','/git/ref/heads/'+targetBranch);
    check(branch===null,'branch-exists-reconcile-with-task4');
    const base=await request('GET','/git/commits/'+sourceSha);
    check(SHA.test(base?.tree?.sha||''),'source-tree-unavailable');
    // GitHub stores the orphan commit before its ref. Task 4 sees an absent
    // branch on failure and holds for reconciliation; neither POST is retried.
    const commit=await request('POST','/git/commits',{
      message:'Ultron.MW authorized canary\n\n'+operationMarker,
      tree:base.tree.sha,parents:[sourceSha],
      author:{name:persona.authorName,email:persona.authorEmail},
    });
    check(SHA.test(commit?.sha||''),'commit-response-invalid');
    await request('POST','/git/refs',{
      ref:'refs/heads/'+targetBranch,sha:commit.sha,
    });
    return Object.freeze({branch:targetBranch,sha:commit.sha,
      operationDigest,remoteVerification:'delegated-to-durable-executor'});
  };
}

/**
 * Independent, token-scoped GitHub readback after the durable executor.
 * A matching digest trailer alone does not prove that the commit descends from
 * the signed source SHA, preserves its tree, or is still the target branch HEAD.
 */
export function createCanaryLineageVerifier({fetchImpl=globalThis.fetch}={}){
  check(typeof fetchImpl==='function','remote-lineage-client-required');
  return async ({token,branch,sourceSha,commitSha,operationDigest})=>{
    check(typeof token==='string'&&token.length>=8&&
      BRANCH.test(branch||'')&&SHA.test(sourceSha||'')&&
      SHA.test(commitSha||'')&&DIGEST.test(operationDigest||''),
      'remote-lineage-scope-invalid');
    const refPath='/git/ref/heads/'+branch;
    async function get(path){
      let response;
      try{
        response=await fetchImpl(API+path,{
          method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
          headers:{Authorization:'Bearer '+token,
            Accept:'application/vnd.github+json',
            'X-GitHub-Api-Version':'2022-11-28'},
        });
      }catch{throw Error('canary-remote-lineage-unavailable');}
      if(!response?.ok)throw Error('canary-remote-lineage-unavailable');
      try{return await response.json();}
      catch{throw Error('canary-remote-lineage-unavailable');}
    }
    const matchesHead=ref=>ref?.ref==='refs/heads/'+branch&&
      ref.object?.type==='commit'&&ref.object.sha===commitSha;
    check(matchesHead(await get(refPath)),'remote-lineage-invalid');
    const [commit,parent]=await Promise.all([
      get('/git/commits/'+commitSha),get('/git/commits/'+sourceSha)]);
    check(commit?.sha===commitSha&&Array.isArray(commit.parents)&&
      commit.parents.length===1&&commit.parents[0]?.sha===sourceSha&&
      SHA.test(commit.tree?.sha||'')&&
      commit.tree.sha===parent?.tree?.sha&&
      typeof commit.message==='string'&&
      commit.message.split(/\r?\n/).includes(
        'Ultron-Operation-Digest: '+operationDigest),
      'remote-lineage-invalid');
    check(matchesHead(await get(refPath)),'remote-lineage-invalid');
    return Object.freeze({verified:true,branch,sourceSha,commitSha,
      operationDigest});
  };
}

/** Five audited interfaces. Trusted credentials, grant verifier and DB are
 * injected by the existing cloud backend, never accepted from the signed JSON.
 */
export async function runMasterPipeline(operationRequest,{
  createVerifiedGitHubClient,enforceSignedApprovalAndTagPersona,
  dispatchHeadlessTask,executeIdempotentGitHubWrite,
  verifyPostConditionsAndStoreReceipt,
  gitOperation=createCanaryCommitOperation(),
  verifyRemoteLineage=createCanaryLineageVerifier(),
  trustedApproval,durableServices,
}={}){
  const payload=safeRequest(operationRequest);
  for(const [name,fn] of Object.entries({createVerifiedGitHubClient,
    enforceSignedApprovalAndTagPersona,dispatchHeadlessTask,
    executeIdempotentGitHubWrite,verifyPostConditionsAndStoreReceipt,
    gitOperation,verifyRemoteLineage}))
    check(typeof fn==='function','dependency-missing-'+name);
  // Task 3 on PR #363 executes the graph on invocation; reject it BEFORE
  // invoking any side effect until it offers a preparation-only contract.
  check(dispatchHeadlessTask.supportsPrepareOnly===true,
    'dispatcher-prepare-contract-required');
  check(typeof durableServices?.db?.query==='function'&&
    typeof durableServices?.authorization?.verify==='function',
    'trusted-durable-adapters-required');

  const identity=await createVerifiedGitHubClient();
  check(identity&&typeof identity.getTokenForScope==='function'&&
    Number.isSafeInteger(identity.installationId),
    'identity-factory-invalid');
  // Task 1 directly validates Task 2's full canonical permission scope.
  const approved=await enforceSignedApprovalAndTagPersona(
    operationRequest,identity,trustedApproval);
  check(approved?.authorized===true&&
    typeof approved.token==='string'&&approved.token.length>=8&&
    plainObject(approved.executionPayload)&&plainObject(approved.persona),
    'authorization-denied');
  const signed=approved.executionPayload;
  check(signed.schema===operationRequest.payload.schema&&
    signed.operation==='repair.branch.create'&&
    signed.repository===REPOSITORY&&signed.activeAgentRole==='Builder'&&
    signed.idempotencyKey==='repair:'+payload.taskId,
    'authorization-payload-mismatch');
  for(const [key,value] of Object.entries({taskId:payload.taskId,
    objective:payload.objective,sourceSha:payload.sourceSha,
    branch:payload.targetBranch}))
    check(signed.parameters?.[key]===value,'authorization-payload-mismatch');
  const operationDigest=createHash('sha256').update(JSON.stringify(signed))
    .digest('hex');
  const task=await dispatchHeadlessTask(payload.objective,{
    taskId:payload.taskId,targetBranch:payload.targetBranch,
    sourceSha:payload.sourceSha,operationDigest,
    requiresResponse:true,enforceSignedApproval:true,prepareOnly:true,
  });
  check(task?.stage==='prepared'&&task.taskId===payload.taskId&&
    task.targetBranch===payload.targetBranch&&task.sourceSha===payload.sourceSha&&
    task.operationDigest===operationDigest,'dispatcher-context-mismatch');
  const persona={...approved.persona,role:String(approved.persona.role).toLowerCase()};
  check(persona.role==='builder','persona-role-mismatch');
  const receipt=await executeIdempotentGitHubWrite(task,approved.token,
    persona,async ({token,persona,targetBranch,operationDigest:observed,operationMarker})=>{
      check(targetBranch===payload.targetBranch&&observed===operationDigest,
        'executor-scope-mismatch');
      return gitOperation({token,persona,targetBranch,
        sourceSha:payload.sourceSha,operationDigest,operationMarker});
    },durableServices);
  check(receipt?.idempotencyKey==='ultron-task-'+payload.taskId&&
    SUCCESS.has(receipt.status)&&receipt.details?.branch===payload.targetBranch&&
    receipt.details?.operationDigest===operationDigest&&
    receipt.details?.remoteVerified===true&&
    SHA.test(receipt.details?.sha||''),'execution-receipt-unverified');
  const lineage=await verifyRemoteLineage({
    token:approved.token,branch:payload.targetBranch,
    sourceSha:payload.sourceSha,commitSha:receipt.details.sha,
    operationDigest,
  });
  check(lineage?.verified===true&&
    lineage.branch===payload.targetBranch&&
    lineage.sourceSha===payload.sourceSha&&
    lineage.commitSha===receipt.details.sha&&
    lineage.operationDigest===operationDigest,'remote-lineage-invalid');
  // Task 5 writes an audit artifact, but explicitly never claims remote proof.
  const audit=await verifyPostConditionsAndStoreReceipt(receipt);
  check(audit?.schema==='ultron.task5.local-audit.v1'&&
    audit.idempotencyKey===receipt.idempotencyKey&&
    audit.executionStatus===receipt.status&&
    audit.status===auditStatus&&audit.remoteReadbackVerified===false&&
    DIGEST.test(audit.auditSha256||'')&&
    DIGEST.test(audit.executionReceiptDigest||''),
    'audit-receipt-unverified');
  return Object.freeze({schema:'ultron.canary-conductor.v1',
    idempotencyKey:receipt.idempotencyKey,status:'remote-verified',
    branch:payload.targetBranch,commitSha:receipt.details.sha,
    auditSha256:audit.auditSha256,auditStatus:audit.status,
    productionAccepted:false});
}

export async function loadLiveDependencies(){
  // Hatchable deploys only cloud/hatchable; the src/scripts live chain is
  // absent there. lib/github-branch-canary.js injects native adapters instead.
  throw Error('canary-live-dependencies-unavailable-on-hatchable');
}
