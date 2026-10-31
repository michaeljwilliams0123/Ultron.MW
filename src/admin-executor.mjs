/**
 * Executable, opt-in GitHub Admin App operations.
 *
 * Does not mint tokens, impersonate the owner, modify protected main,
 * or authorize itself. A trusted composition root must inject independently
 * observed installation identity, owner grant verification, durable ledger,
 * stop state, and an authenticated GitHub transport.
 *
 * Reserve-before-write prevents an uncertain API response from causing a
 * second external mutation. The normal caller MUST NOT retry an uncertain
 * write: reconcile its expected postcondition by independent readback.
 */
import {createHash} from 'node:crypto';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const REST='/repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const ID_KEY=/^admin:[a-z0-9][a-z0-9-]{7,90}$/;
const ALLOWED_WORKFLOWS=new Set([
 'verify.yml','council-debate.yml','continuum-council-supervisor.yml'
]);
const METHODS=Object.freeze({
 'actions.dispatch':{permission:'actions',mode:'routine'},
 'actions.rerun_failed':{permission:'actions',mode:'routine'},
 'actions.cancel':{permission:'actions',mode:'routine'},
 'actions.enable':{permission:'actions',mode:'step-up'},
 'actions.disable':{permission:'actions',mode:'step-up'},
 'repository.settings.update':{permission:'administration',mode:'step-up'},
 'webhooks.ping':{permission:'webhooks',mode:'step-up'},
});
export const ADMIN_OPERATIONS=Object.freeze(Object.keys(METHODS));
const PLAN_KEYS=new Set(['schema','owner','repository','operation','params',
 'expected','idempotencyKey','expiresAt','maxCostCents']);
const SETTINGS=new Set(['allow_squash_merge','delete_branch_on_merge']);

function check(ok,message='Admin plan rejected'){
 if(!ok)throw Error(message);
}
function exactKeys(value,keys){
 return value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===keys.length &&
  Object.keys(value).every(x=>keys.includes(x));
}
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value))return NaN;
 return Date.parse(value);
}
function validWorkflow(name){return typeof name==='string'&&ALLOWED_WORKFLOWS.has(name);}
function positiveId(n){return Number.isSafeInteger(n)&&n>0;}
function requiredExpectedRun(plan,kind){
 return exactKeys(plan.expected,kind==='cancel'?['runAttempt','headSha','status']:
  ['runAttempt','headSha','conclusion']) &&
  positiveId(plan.expected.runAttempt) && SHA.test(plan.expected.headSha) &&
  (kind==='cancel'?plan.expected.status==='in_progress':
   plan.expected.conclusion==='failure');
}
export function validateAdminPlan(plan,now){
 const time=instant(now),expires=instant(plan?.expiresAt);
 check(Number.isFinite(time),'Admin plan time invalid');
 check(plan&&typeof plan==='object'&&!Array.isArray(plan) &&
  Object.keys(plan).every(k=>PLAN_KEYS.has(k))&&
  Object.keys(plan).length===PLAN_KEYS.size &&
  plan.schema==='ultron.admin.plan.v1' &&
  plan.owner==='michaeljwilliams0123' && plan.repository===REPO &&
  Object.hasOwn(METHODS,plan.operation) &&
  ID_KEY.test(plan.idempotencyKey||'') &&
  plan.maxCostCents===0 &&
  Number.isFinite(expires)&&expires>time&&expires<=time+10*60*1000,
  'Admin plan rejected: scope, cost or expiry');
 let ok=false;
 const p=plan.params;
 switch(plan.operation){
  case 'actions.dispatch':
   ok=validWorkflow(p?.workflow)&&p.ref==='main'&&
    exactKeys(plan.expected,[])&&
    (p.workflow==='council-debate.yml'
     ? exactKeys(p,['workflow','ref','itemNumber'])&&positiveId(p.itemNumber)
     : exactKeys(p,['workflow','ref']));break;
  case 'actions.rerun_failed':
   ok=exactKeys(p,['runId'])&&positiveId(p.runId)&&
    requiredExpectedRun(plan,'rerun');break;
  case 'actions.cancel':
   ok=exactKeys(p,['runId'])&&positiveId(p.runId)&&
    requiredExpectedRun(plan,'cancel');break;
  case 'actions.enable':
  case 'actions.disable':
   ok=exactKeys(p,['workflow'])&&validWorkflow(p.workflow)&&
    !(plan.operation==='actions.disable'&&p.workflow==='verify.yml')&&
    exactKeys(plan.expected,['state']) &&
    (plan.operation==='actions.enable'
     ?plan.expected.state==='disabled_manually'
     :plan.expected.state==='active');break;
  case 'repository.settings.update':
   ok=exactKeys(p,['setting','value'])&&SETTINGS.has(p.setting)&&
    typeof p.value==='boolean'&&exactKeys(plan.expected,['value'])&&
    typeof plan.expected.value==='boolean'&&
    plan.expected.value!==p.value;break;
  case 'webhooks.ping':
   ok=exactKeys(p,['webhookId'])&&positiveId(p.webhookId)&&
    exactKeys(plan.expected,['active'])&&plan.expected.active===true;break;
 }
 check(ok,'Admin plan rejected: operation or scope mismatch');
 return Object.freeze({planDigest:createHash('sha256')
  .update(JSON.stringify(plan)).digest('hex'),
  operation:plan.operation,
  requiresStepUp:METHODS[plan.operation].mode==='step-up'});
}
function assertIdentity(identity,operation,now){
 const permission=METHODS[operation].permission;
 const valid=identity&&identity.source==='github-installation-token-readback'&&
  identity.verified===true&&identity.principal==='admin-app'&&
  identity.repository===REPO&&identity.repositoryId===REPO_ID&&
  positiveId(identity.installationId)&&
  /^github-app:[a-z0-9][a-z0-9-]{2,70}$/.test(identity.actorRef||'')&&
  instant(identity.expiresAt)>now&&
  identity.permissions?.metadata==='read'&&
  identity.permissions?.[permission]==='write';
 check(valid,'Admin identity or permission readback invalid');
}
function assertApproval(approval,planDigest,requiresStepUp,now){
 const valid=approval&&approval.verified===true&&
  approval.actor==='michaeljwilliams0123'&&
  approval.planDigest===planDigest&&
  typeof approval.grantId==='string'&&approval.grantId.length>5&&
  instant(approval.expiresAt)>now&&
  (approval.source==='independent-owner-authorization'||
   (!requiresStepUp && approval.source==='independent-standing-grant'));
 check(valid,'Admin authorization invalid or missing');
}
function getPreconditionPath(plan){
 switch(plan.operation){
  case 'actions.dispatch':
  case 'actions.enable':
  case 'actions.disable':
   return REST+'/actions/workflows/'+plan.params.workflow;
  case 'actions.rerun_failed':
  case 'actions.cancel':
   return REST+'/actions/runs/'+plan.params.runId;
  case 'repository.settings.update':return REST;
  case 'webhooks.ping':return REST+'/hooks/'+plan.params.webhookId;
 }
}
function assertPrecondition(plan,observed){
 let ok=false;
 switch(plan.operation){
  case 'actions.dispatch':ok=observed?.state==='active';break;
  case 'actions.rerun_failed':
   ok=observed?.status==='completed' &&
    observed.conclusion===plan.expected.conclusion &&
    observed.run_attempt===plan.expected.runAttempt &&
    observed.head_sha===plan.expected.headSha;break;
  case 'actions.cancel':
   ok=observed?.status===plan.expected.status &&
    observed.run_attempt===plan.expected.runAttempt &&
    observed.head_sha===plan.expected.headSha;break;
  case 'actions.enable':
  case 'actions.disable':
   ok=observed?.state===plan.expected.state;break;
  case 'repository.settings.update':
   ok=observed?.[plan.params.setting]===plan.expected.value;break;
  case 'webhooks.ping':ok=observed?.active===true;break;
 }
 check(ok,'Admin precondition failed: stale or changed GitHub state');
}
function mutation(plan){
 const p=plan.params;
 switch(plan.operation){
  case 'actions.dispatch':
   return {method:'POST',path:REST+'/actions/workflows/'+p.workflow+'/dispatches',
    data:{ref:'main',inputs:p.workflow==='council-debate.yml'
     ? {item_number:String(p.itemNumber),is_pr:'false'}:{}}};
  case 'actions.rerun_failed':
   return {method:'POST',path:REST+'/actions/runs/'+p.runId+'/rerun-failed-jobs'};
  case 'actions.cancel':
   return {method:'POST',path:REST+'/actions/runs/'+p.runId+'/cancel'};
  case 'actions.enable':
   return {method:'PUT',path:REST+'/actions/workflows/'+p.workflow+'/enable'};
  case 'actions.disable':
   return {method:'PUT',path:REST+'/actions/workflows/'+p.workflow+'/disable'};
  case 'repository.settings.update':
   return {method:'PATCH',path:REST,data:{[p.setting]:p.value}};
  case 'webhooks.ping':
   return {method:'POST',path:REST+'/hooks/'+p.webhookId+'/pings'};
 }
}
function verifiedPostcondition(plan,observed){
 switch(plan.operation){
  case 'actions.enable':return observed?.state==='active';
  case 'actions.disable':return observed?.state==='disabled_manually';
  case 'repository.settings.update':
   return observed?.[plan.params.setting]===plan.params.value;
  default:return false; // asynchronous results need separate evidence
 }
}
/**
 * An authorized executable path, not a planner grant.
 * Services come from trusted runtime construction and have interfaces:
 *  clock() -> ISO time, control.read(), identity.read(), authority.verify(plan,digest),
 *  ledger.reserve(record) -> {created:boolean}, ledger.mark(record),
 *  github.request(method,path,optionalJson) -> HTTP-like response.
 */
export async function executeAdminOperation(plan,services){
 check(services?.clock&&services?.control?.read&&services?.identity?.read&&
  services?.authority?.verify&&services?.ledger?.reserve&&
  services?.ledger?.mark&&services?.github?.request,
  'Admin trusted service adapter missing');
 const now=services.clock(),time=instant(now);
 const validation=validateAdminPlan(plan,now);
 const controls=await services.control.read();
 check(controls?.paused===false&&controls.revoked===false,
  'Admin stopped: paused or revoked');
 const identity=await services.identity.read();
 assertIdentity(identity,plan.operation,time);
 const approval=await services.authority.verify(plan,validation.planDigest);
 assertApproval(approval,validation.planDigest,validation.requiresStepUp,time);
 const path=getPreconditionPath(plan);
 const before=await services.github.request('GET',path);
 assertPrecondition(plan,before);
 const intent={schema:'ultron.admin.attempt.v1',
  idempotencyKey:plan.idempotencyKey,planDigest:validation.planDigest,
  repository:REPO,operation:plan.operation,installationId:identity.installationId,
  grantId:approval.grantId,precondition:plan.expected,
  state:'reserved',observedAt:now};
 const claim=await services.ledger.reserve(intent);
 if(claim?.created!==true)
  return Object.freeze({state:'reconcile-required',reason:'duplicate-or-unknown-attempt',
   idempotencyKey:plan.idempotencyKey});
 const request=mutation(plan);
 try{
  const result=await services.github.request(request.method,request.path,request.data);
  const code=Number(result?.status);
  if(!Number.isInteger(code)||code<200||code>=300)
   throw Error('GitHub mutation returned invalid status');
  let state='dispatched-unverified';
  if(['actions.enable','actions.disable','repository.settings.update'].includes(plan.operation)){
   const after=await services.github.request('GET',path);
   if(verifiedPostcondition(plan,after))state='verified';
   else state='reconcile-required';
  }
  await services.ledger.mark({...intent,state,dispatchStatus:code});
  return Object.freeze({state,operation:plan.operation,
   idempotencyKey:plan.idempotencyKey,planDigest:validation.planDigest});
 }catch{
  // The effect may have committed. Never automatically repeat a POST/PATCH/PUT.
  await services.ledger.mark({...intent,state:'reconcile-required'});
  return Object.freeze({state:'reconcile-required',
   operation:plan.operation,reason:'write-outcome-unknown',
   idempotencyKey:plan.idempotencyKey});
 }
}
