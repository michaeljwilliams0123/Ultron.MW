/**
 * Executable GitHub operations for the single Ultron GitHub App principal.
 *
 * The principal is shared; authority is not. Every request uses one exact
 * operation profile and a down-scoped, short-lived installation token.
 * High-impact operations additionally require a fresh independent owner grant.
 * The executor never mints credentials, merges, deploys, or retries an external
 * write whose outcome may be uncertain.
 */
import {createHash} from 'node:crypto';
import {
 assertOperationAuthorization,assertUnifiedGitHubIdentity,operationProfile,
 parseInstant,ULTRON_REPOSITORY,
} from './github-principal-policy.mjs';

const REST='/repos/'+ULTRON_REPOSITORY;
const SHA=/^[a-f0-9]{40}$/;
const BRANCH=/^ultron\/[a-z0-9][a-z0-9-]{2,63}$/;
const ID_KEY=/^(?:repair|admin):[a-z0-9][a-z0-9-]{7,90}$/;
const WORKFLOWS=new Set(['verify.yml','council-debate.yml']);
const OPERATIONS=new Set([
 'actions.verify.dispatch','actions.rerun_failed','actions.cancel',
 'actions.enable','actions.disable','repository.settings.update','webhooks.ping',
]);
const PLAN_KEYS=['schema','owner','repository','sourceSha','operation','params',
 'expected','idempotencyKey','expiresAt','maxCostCents','paidFallback'];
const SETTINGS=new Set(['allow_squash_merge','delete_branch_on_merge']);

export const EXECUTABLE_GITHUB_OPERATIONS=Object.freeze([...OPERATIONS]);

function check(ok,message='GitHub operation plan rejected'){
 if(!ok)throw Error(message);
}
function exactKeys(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  Object.keys(value).every(key=>keys.includes(key));
}
function positiveId(value){return Number.isSafeInteger(value)&&value>0;}
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);
  for(const child of Object.values(value))deepFreeze(child);
 }
 return value;
}
function snapshotPlan(plan){
 try{return deepFreeze(structuredClone(plan));}
 catch{throw Error('GitHub operation plan must be plain data');}
}
function digest(plan){
 return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
function requiredRunExpected(plan,kind){
 return exactKeys(plan.expected,kind==='cancel'
  ?['runAttempt','headSha','status']:['runAttempt','headSha','conclusion'])&&
  positiveId(plan.expected.runAttempt)&&SHA.test(plan.expected.headSha)&&
  (kind==='cancel'?plan.expected.status==='in_progress':
   plan.expected.conclusion==='failure');
}

export function validateGitHubOperationPlan(input,now){
 const plan=snapshotPlan(input),time=parseInstant(now),expires=parseInstant(plan?.expiresAt);
 check(Number.isFinite(time),'GitHub operation plan time invalid');
 check(exactKeys(plan,PLAN_KEYS)&&
  plan.schema==='ultron.github.operation-plan.v1'&&
  plan.owner==='michaeljwilliams0123'&&plan.repository===ULTRON_REPOSITORY&&
  SHA.test(plan.sourceSha||'')&&OPERATIONS.has(plan.operation)&&
  ID_KEY.test(plan.idempotencyKey||'')&&plan.maxCostCents===0&&
  plan.paidFallback===false&&Number.isFinite(expires)&&expires>time&&
  expires<=time+10*60*1000,
 'GitHub operation plan rejected: scope, cost or expiry');
 let valid=false;
 switch(plan.operation){
  case 'actions.verify.dispatch':
   valid=exactKeys(plan.params,['ref','headSha'])&&BRANCH.test(plan.params.ref)&&
    SHA.test(plan.params.headSha)&&
    exactKeys(plan.expected,['workflowState','refSha'])&&
    plan.expected.workflowState==='active'&&plan.expected.refSha===plan.params.headSha;
   break;
  case 'actions.rerun_failed':
   valid=exactKeys(plan.params,['runId'])&&positiveId(plan.params.runId)&&
    requiredRunExpected(plan,'rerun');break;
  case 'actions.cancel':
   valid=exactKeys(plan.params,['runId'])&&positiveId(plan.params.runId)&&
    requiredRunExpected(plan,'cancel');break;
  case 'actions.enable':
  case 'actions.disable':
   valid=exactKeys(plan.params,['workflow'])&&WORKFLOWS.has(plan.params.workflow)&&
    !(plan.operation==='actions.disable'&&plan.params.workflow==='verify.yml')&&
    exactKeys(plan.expected,['state'])&&
    plan.expected.state===(plan.operation==='actions.enable'
     ?'disabled_manually':'active');break;
  case 'repository.settings.update':
   valid=exactKeys(plan.params,['setting','value'])&&SETTINGS.has(plan.params.setting)&&
    typeof plan.params.value==='boolean'&&exactKeys(plan.expected,['value'])&&
    typeof plan.expected.value==='boolean'&&
    plan.expected.value!==plan.params.value;break;
  case 'webhooks.ping':
   valid=exactKeys(plan.params,['webhookId'])&&positiveId(plan.params.webhookId)&&
    exactKeys(plan.expected,['active'])&&plan.expected.active===true;break;
 }
 check(valid,'GitHub operation plan rejected: operation or scope mismatch');
 return Object.freeze({plan,planDigest:digest(plan),
  authorization:operationProfile(plan.operation).authorization});
}

function preconditionRequests(plan){
 switch(plan.operation){
  case 'actions.verify.dispatch':return [
   REST+'/actions/workflows/verify.yml',REST+'/git/ref/heads/'+plan.params.ref,
  ];
  case 'actions.rerun_failed':
  case 'actions.cancel':return [REST+'/actions/runs/'+plan.params.runId];
  case 'actions.enable':
  case 'actions.disable':return [REST+'/actions/workflows/'+plan.params.workflow];
  case 'repository.settings.update':return [REST];
  case 'webhooks.ping':return [REST+'/hooks/'+plan.params.webhookId];
 }
}
function assertPreconditions(plan,observed){
 let valid=false;
 switch(plan.operation){
  case 'actions.verify.dispatch':
   valid=observed[0]?.state===plan.expected.workflowState&&
    observed[1]?.object?.type==='commit'&&
    observed[1]?.object?.sha===plan.expected.refSha;break;
  case 'actions.rerun_failed':
   valid=observed[0]?.status==='completed'&&
    observed[0]?.conclusion===plan.expected.conclusion&&
    observed[0]?.run_attempt===plan.expected.runAttempt&&
    observed[0]?.head_sha===plan.expected.headSha;break;
  case 'actions.cancel':
   valid=observed[0]?.status===plan.expected.status&&
    observed[0]?.run_attempt===plan.expected.runAttempt&&
    observed[0]?.head_sha===plan.expected.headSha;break;
  case 'actions.enable':
  case 'actions.disable':valid=observed[0]?.state===plan.expected.state;break;
  case 'repository.settings.update':
   valid=observed[0]?.[plan.params.setting]===plan.expected.value;break;
  case 'webhooks.ping':valid=observed[0]?.active===true;break;
 }
 check(valid,'GitHub operation precondition failed: stale or changed state');
}
function mutation(plan){
 switch(plan.operation){
  case 'actions.verify.dispatch':return {method:'POST',
   path:REST+'/actions/workflows/verify.yml/dispatches',data:{ref:plan.params.ref}};
  case 'actions.rerun_failed':return {method:'POST',
   path:REST+'/actions/runs/'+plan.params.runId+'/rerun-failed-jobs'};
  case 'actions.cancel':return {method:'POST',
   path:REST+'/actions/runs/'+plan.params.runId+'/cancel'};
  case 'actions.enable':return {method:'PUT',
   path:REST+'/actions/workflows/'+plan.params.workflow+'/enable'};
  case 'actions.disable':return {method:'PUT',
   path:REST+'/actions/workflows/'+plan.params.workflow+'/disable'};
  case 'repository.settings.update':return {method:'PATCH',path:REST,
   data:{[plan.params.setting]:plan.params.value}};
  case 'webhooks.ping':return {method:'POST',
   path:REST+'/hooks/'+plan.params.webhookId+'/pings'};
 }
}
function verifiedPostcondition(plan,observed){
 switch(plan.operation){
  case 'actions.enable':return observed?.state==='active';
  case 'actions.disable':return observed?.state==='disabled_manually';
  case 'repository.settings.update':
   return observed?.[plan.params.setting]===plan.params.value;
  default:return false;
 }
}
async function markOrResidual(services,record,result){
 try{await services.ledger.mark(record);return result;}
 catch{return Object.freeze({...result,state:'reconcile-required',ledgerMarkFailed:true});}
}

/**
 * Trusted adapters:
 * clock(); control.read(); identity.read(operation); authority.verify(plan,digest);
 * ledger.reserve(record); ledger.mark(record);
 * github.request(operation,method,path,optionalJson).
 */
export async function executeGitHubOperation(input,services){
 check(services?.clock&&services?.control?.read&&services?.identity?.read&&
  services?.authority?.verify&&services?.ledger?.reserve&&services?.ledger?.mark&&
  services?.github?.request,'Trusted GitHub operation service adapter missing');
 const startedAt=services.clock();
 const validation=validateGitHubOperationPlan(input,startedAt);
 const plan=validation.plan;
 const controls=await services.control.read();
 check(controls?.paused===false&&controls.revoked===false,
  'GitHub operations stopped: paused or revoked');
 const identityEvidence=await services.identity.read(plan.operation);
 const identity=assertUnifiedGitHubIdentity(identityEvidence,
  {operation:plan.operation,now:startedAt});
 const authorizationEvidence=await services.authority.verify(plan,validation.planDigest);
 const authorization=assertOperationAuthorization(authorizationEvidence,{
  operation:plan.operation,planDigest:validation.planDigest,
  idempotencyKey:plan.idempotencyKey,installationId:identity.installationId,
  now:startedAt,
 });
 const observed=[];
 for(const path of preconditionRequests(plan))
  observed.push(await services.github.request(plan.operation,'GET',path));
 assertPreconditions(plan,observed);

 // Re-check every expiring authority at the last safe point before reservation.
 const beforeReserve=services.clock();
 validateGitHubOperationPlan(plan,beforeReserve);
 const finalControls=await services.control.read();
 check(finalControls?.paused===false&&finalControls.revoked===false,
  'GitHub operations stopped before dispatch');
 const finalIdentityEvidence=await services.identity.read(plan.operation);
 const finalIdentity=assertUnifiedGitHubIdentity(finalIdentityEvidence,
  {operation:plan.operation,now:beforeReserve});
 check(finalIdentity.installationId===identity.installationId&&
  finalIdentity.actorRef===identity.actorRef,
 'Unified GitHub App identity changed before dispatch');
 assertOperationAuthorization(authorizationEvidence,{
  operation:plan.operation,planDigest:validation.planDigest,
  idempotencyKey:plan.idempotencyKey,installationId:identity.installationId,
  now:beforeReserve,
 });
 const intent=deepFreeze({schema:'ultron.github.operation-attempt.v1',
  idempotencyKey:plan.idempotencyKey,planDigest:validation.planDigest,
  sourceSha:plan.sourceSha,repository:ULTRON_REPOSITORY,operation:plan.operation,
  installationId:finalIdentity.installationId,grantId:authorization.grantId,
  tokenProfile:plan.operation,precondition:structuredClone(plan.expected),
  maxCostCents:0,paidFallback:false,state:'reserved',observedAt:beforeReserve});
 const claim=await services.ledger.reserve(intent);
 if(claim?.created!==true)return Object.freeze({state:'reconcile-required',
  reason:'duplicate-or-unknown-attempt',idempotencyKey:plan.idempotencyKey});

 const request=mutation(plan);
 try{
  const result=await services.github.request(plan.operation,request.method,
   request.path,request.data);
  const status=Number(result?.status);
  if(!Number.isInteger(status)||status<200||status>=300)
   throw Error('GitHub mutation returned invalid status');
  let state='dispatched-unverified';
  if(['actions.enable','actions.disable','repository.settings.update'].includes(plan.operation)){
   const after=await services.github.request(plan.operation,'GET',
    preconditionRequests(plan)[0]);
   state=verifiedPostcondition(plan,after)?'verified':'reconcile-required';
  }
  const response=Object.freeze({state,operation:plan.operation,
   idempotencyKey:plan.idempotencyKey,planDigest:validation.planDigest});
  return markOrResidual(services,{...intent,state,dispatchStatus:status},response);
 }catch(error){
  const residual=Object.freeze({state:'reconcile-required',operation:plan.operation,
   reason:'write-outcome-unknown',idempotencyKey:plan.idempotencyKey});
  return markOrResidual(services,{...intent,state:'reconcile-required',
   errorName:String(error?.name??'Error')},residual);
 }
}
