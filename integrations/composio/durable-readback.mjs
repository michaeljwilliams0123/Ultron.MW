/**
 * Composio v3 -> trusted GitHub App write adapter.
 *
 * This never executes a Composio OAuth-based mutation. It converts an actual
 * cryptographically approved owner operation into the existing Task 4 durable
 * GitHub App executor. Task 4 owns migration 0039, remote readback, ambiguity,
 * immutable terminal receipts and duplicate-effect admission.
 */
import {createHash} from 'node:crypto';
import {executeIdempotentGitHubWrite} from '../../src/engine/durable-executor.mjs';
import {
 isCryptographicallyApprovedOperation
} from '../../src/middleware/enforce-signed-approval.mjs';
import {ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
 requiredTokenPermissions} from '../../src/github-principal-policy.mjs';

const SHA=/^[a-f0-9]{40}$/;
const TASK=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/;
const BRANCH=/^(?:canary|ultron|feature)\/[a-z0-9][a-z0-9._/-]+$/i;
const LIVE=new WeakSet();
const fail=reason=>{throw Error('Composio durable App execution denied: '+reason);};
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&Object.keys(v).every(x=>keys.includes(x));
const sha256=value=>createHash('sha256').update(value).digest('hex');

function approvedContext(approved){
 if(!isCryptographicallyApprovedOperation(approved)||
    approved.authorized!==true||!Object.isFrozen(approved.executionPayload))
  fail('trusted approved operation required');
 const plan=approved.executionPayload;
 const params=plan?.parameters;
 if(!exact(plan,['schema','repository','operation','activeAgentRole',
    'idempotencyKey','permittedScope','parameters'])||
    plan.schema!=='ultron.github.operation.v1'||
    plan.repository!==ULTRON_REPOSITORY||
    plan.operation!=='repair.branch.create'||
    plan.activeAgentRole!=='Builder'||approved.persona?.role!=='Builder'||
    !exact(params,['taskId','sourceSha','branch'])&&
      !exact(params,['taskId','sourceSha','branch','objective'])||
    !TASK.test(params?.taskId||'')||
    !SHA.test(params?.sourceSha||'')||
    typeof params?.branch!=='string'||!BRANCH.test(params.branch)||
    params.branch.includes('..')||params.branch.includes('//')||
    plan.idempotencyKey!=='repair:'+params.taskId)
  fail('unsupported or inconsistent signed GitHub branch plan');
 const expectedPermissions=requiredTokenPermissions(plan.operation);
 if(!exact(plan.permittedScope,['operation','repositoryId','permissions'])||
    plan.permittedScope.operation!==plan.operation||
    plan.permittedScope.repositoryId!==ULTRON_REPOSITORY_ID||
    !exact(plan.permittedScope.permissions,Object.keys(expectedPermissions))||
    Object.entries(expectedPermissions).some(([k,v])=>plan.permittedScope.permissions[k]!==v))
  fail('signed token permissions conflict');
 const taskContext=Object.freeze({
  taskId:params.taskId,repository:ULTRON_REPOSITORY,
  targetBranch:params.branch,sourceSha:params.sourceSha,
  operationDigest:sha256(JSON.stringify(plan)),
 });
 return Object.freeze({taskContext,sourceSha:params.sourceSha});
}
/** Build only in the authenticated server composition root. */
export function createComposioDurableAppExecutor({services,gitOperation}={}){
 if(services?.remote!==undefined)
  fail('direct inspector override denied');
 if(typeof services?.db?.query!=='function'||
    typeof services?.authorization?.verify!=='function'||
    typeof services?.fetchImpl!=='function'||
    typeof gitOperation!=='function')
  fail('trusted PostgreSQL, GitHub GET transport, authorization and App writer required');
 // Never supply services.remote: Task 4's inspectGitHubBranch performs an
 // independent ref/commit/parent/ref GET sequence, not a claimed match from
 // a caller-provided callback.
 const runtimeServices=Object.freeze({
  db:services.db,authorization:services.authorization,
  fetchImpl:services.fetchImpl,
  ...(services.clock?{clock:services.clock}:{})
 });
 const executor=async approved=>{
  const {taskContext,sourceSha}=approvedContext(approved);
  // An owner-approved operation must still satisfy Task 4's independently
  // verified operation-specific authorization on both sides of the SQL CAS.
  const result=await executeIdempotentGitHubWrite(
   taskContext,approved.token,
   Object.freeze({role:'builder'}),
   request=>gitOperation(Object.freeze({...request,sourceSha})),
   runtimeServices
  );
  // Task 4 returns a verified receipt only after independent provider GET and
  // fresh PostgreSQL SELECT; never convert HTTP 200 alone into success.
  if(!['success','reconciled_success','recovered_success'].includes(result?.status))
   return result;
  if(result?.details?.remoteVerified!==true||
     result.details.operationDigest!==taskContext.operationDigest||
     result.details.repository!==ULTRON_REPOSITORY||
     result.details.branch!==taskContext.targetBranch||
     !SHA.test(result.details.sha||''))
   fail('durable receipt does not match signed operation');
  return result;
 };
 LIVE.add(executor);
 return executor;
}
/** Prevent an injected arbitrary callback from being treated as a trusted writer. */
export function isComposioDurableAppExecutor(value){
 return typeof value==='function'&&LIVE.has(value);
}
