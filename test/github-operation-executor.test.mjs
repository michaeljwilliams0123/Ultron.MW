import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 executeGitHubOperation,validateGitHubOperationPlan,
} from '../src/github-operation-executor.mjs';
import {
 operationProfile,requiredTokenPermissions,ULTRON_GITHUB_PRINCIPAL,
 ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
} from '../src/github-principal-policy.mjs';

const NOW='2026-10-31T20:00:00Z';
const HEAD='a'.repeat(40),SOURCE='b'.repeat(40);
const plan=(operation='actions.verify.dispatch',patch={})=>({
 schema:'ultron.github.operation-plan.v1',owner:'michaeljwilliams0123',
 repository:ULTRON_REPOSITORY,sourceSha:SOURCE,operation,
 params:{ref:'ultron/unified-principal',headSha:HEAD},
 expected:{workflowState:'active',refSha:HEAD},
 idempotencyKey:'admin:unified-001',expiresAt:'2026-10-31T20:08:00Z',
 maxCostCents:0,paidFallback:false,...patch,
});
const settings=()=>plan('repository.settings.update',{
 params:{setting:'delete_branch_on_merge',value:true},expected:{value:false},
});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function harness(input,options={}){
 const calls=[],marks=[],clockValues=[...(options.clockValues||[NOW])];
 const identity={source:'github-installation-token-readback',verified:true,
  principal:ULTRON_GITHUB_PRINCIPAL,repository:ULTRON_REPOSITORY,
  repositoryId:ULTRON_REPOSITORY_ID,installationId:9123,
  actorRef:'github-app:ultron-operator',operation:input.operation,
  expiresAt:'2026-10-31T20:09:00Z',permissions:requiredTokenPermissions(input.operation),
  ...(options.identity||{})};
 const expectedDigest=digest(input);
 const authorization={
  source:operationProfile(input.operation).authorization==='step-up'
   ?'independent-owner-authorization':'independent-standing-grant',
  verified:true,actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
  operation:input.operation,planDigest:expectedDigest,
  idempotencyKey:input.idempotencyKey,installationId:9123,
  grantId:'grant:unified-001',expiresAt:'2026-10-31T20:07:00Z',
  ...(options.authorization||{})};
 let repositoryReadCount=0;
 const services={
  clock:()=>clockValues.shift()||NOW,
  control:{read:async()=>{
   if(options.controlThrows)throw Error('control unavailable');
   return options.control===undefined?{paused:false,revoked:false}:options.control;
  }},
  identity:{read:async()=>identity},
  authority:{verify:async()=>authorization},
  ledger:{
   reserve:async record=>{
    if(options.reserveFailure)throw Error('reserve failed');
    return options.reserveResult||{created:true,record};
   },
   mark:async record=>{
    if(options.markFailure)throw Error('mark failed');
    marks.push(record);
   },
  },
  github:{request:async(operation,method,path,data)=>{
   calls.push({operation,method,path,data});
   if(method!=='GET'){
    if(options.mutateThrows)throw Error('network response lost');
    return {status:options.mutateStatus||204};
   }
   if(path.endsWith('/actions/workflows/verify.yml'))return {state:'active'};
   if(path.includes('/git/ref/heads/'))return {object:{type:'commit',sha:HEAD}};
   if(path.includes('/actions/runs/'))return options.run||{
    status:'completed',conclusion:'failure',run_attempt:1,head_sha:HEAD};
   if(path.endsWith('/actions/workflows/council-debate.yml'))
    return {state:options.workflowAfter?'active':'disabled_manually'};
   if(path.includes('/hooks/'))return {active:true};
   if(path===`/repos/${ULTRON_REPOSITORY}`){
    repositoryReadCount++;
    return {delete_branch_on_merge:repositoryReadCount>1
      ?options.afterSetting??true:false};
   }
   throw Error('unexpected read');
  }},
 };
 return {services,calls,marks,identity,authorization};
}

test('exact-head Verify dispatch uses one routine token profile and records zero-cost intent',async()=>{
 const input=plan(),{services,calls,marks}=harness(input);
 const result=await executeGitHubOperation(input,services);
 assert.equal(result.state,'dispatched-unverified');
 assert.deepEqual(calls.map(call=>[call.method,call.path]),[
  ['GET',`/repos/${ULTRON_REPOSITORY}/actions/workflows/verify.yml`],
  ['GET',`/repos/${ULTRON_REPOSITORY}/git/ref/heads/ultron/unified-principal`],
  ['POST',`/repos/${ULTRON_REPOSITORY}/actions/workflows/verify.yml/dispatches`],
 ]);
 assert.deepEqual(calls[2].data,{ref:'ultron/unified-principal'});
 assert.equal(marks[0].sourceSha,SOURCE);
 assert.equal(marks[0].maxCostCents,0);
 assert.equal(marks[0].paidFallback,false);
 assert.equal(JSON.stringify(marks).includes('test-only-credential'),false);
});

test('high-impact setting change requires exact independent step-up and verified readback',async()=>{
 const input=settings(),{services,calls}=harness(input);
 const result=await executeGitHubOperation(input,services);
 assert.equal(result.state,'verified');
 assert.equal(calls.filter(call=>call.method==='PATCH').length,1);
 for(const patch of [
  {source:'independent-standing-grant'}, {verified:false},
  {actor:'someone-else'}, {planDigest:'0'.repeat(64)},
  {operation:'actions.cancel'}, {installationId:99},
 ]){
  const run=harness(input,{authorization:patch});
  await assert.rejects(executeGitHubOperation(input,run.services),/authorization/i);
  assert.equal(run.calls.length,0);
 }
});

test('plan validation freezes plain input and rejects paid, stale, unsafe or altered scope',()=>{
 const input=plan();
 const result=validateGitHubOperationPlan(input,NOW);
 input.params.ref='main';
 assert.equal(result.plan.params.ref,'ultron/unified-principal');
 assert.equal(Object.isFrozen(result.plan.params),true);
 for(const patch of [
  {repository:'other/repo'}, {sourceSha:'main'}, {maxCostCents:1},
  {paidFallback:true}, {expiresAt:'2026-10-31T20:08:00'},
  {operation:'pull_request.merge'},
  {params:{ref:'main',headSha:HEAD}},
  {params:{ref:'ultron/unified-principal',headSha:'main'}},
  {expected:{workflowState:'active',refSha:'c'.repeat(40)}},
 ]) assert.throws(()=>validateGitHubOperationPlan(plan('actions.verify.dispatch',patch),NOW),
  /plan rejected|profile/i);
});

test('identity must be the same installation and exact per-operation permission profile',async()=>{
 const input=plan();
 for(const identity of [
  {principal:'repair-app'}, {installationId:0},
  {repositoryId:1}, {operation:'actions.cancel'},
  {permissions:{...requiredTokenPermissions(input.operation),administration:'write'}},
  {expiresAt:'2026-10-31T20:09:00'},
 ]){
  const run=harness(input,{identity});
  await assert.rejects(executeGitHubOperation(input,run.services),/identity|profile/i);
  assert.equal(run.calls.length,0);
 }
});

test('pause, revoke and unavailable control deny before GitHub access',async()=>{
 const input=plan();
 for(const options of [
  {control:{paused:true,revoked:false}},
  {control:{paused:false,revoked:true}},
  {control:null}, {controlThrows:true},
 ]){
  const run=harness(input,options);
  await assert.rejects(executeGitHubOperation(input,run.services));
  assert.equal(run.calls.length,0);
 }
});

test('authority expiry is rechecked immediately before reservation and write',async()=>{
 const input=plan(),run=harness(input,{clockValues:[NOW,'2026-10-31T20:08:01Z']});
 await assert.rejects(executeGitHubOperation(input,run.services),/expiry|authorization|identity/i);
 assert.equal(run.calls.filter(call=>call.method!=='GET').length,0);
});

test('last-moment stop or installation identity change denies before mutation',async()=>{
 const input=plan();
 const stopped=harness(input);let controlReads=0;
 stopped.services.control.read=async()=>controlReads++===0
  ?{paused:false,revoked:false}:{paused:true,revoked:false};
 await assert.rejects(executeGitHubOperation(input,stopped.services),/stopped before dispatch/);
 assert.equal(stopped.calls.filter(call=>call.method!=='GET').length,0);

 const changed=harness(input);let identityReads=0;
 const original=changed.services.identity.read;
 changed.services.identity.read=async operation=>{
  const value=await original(operation);
  return identityReads++===0?value:{...value,installationId:9999};
 };
 await assert.rejects(executeGitHubOperation(input,changed.services),/identity changed/);
 assert.equal(changed.calls.filter(call=>call.method!=='GET').length,0);
});

test('reserve failure, duplicate reservation and uncertain writes never issue a second mutation',async()=>{
 const input=settings();
 const reserve=harness(input,{reserveFailure:true});
 await assert.rejects(executeGitHubOperation(input,reserve.services),/reserve failed/);
 assert.equal(reserve.calls.filter(call=>call.method!=='GET').length,0);

 const duplicate=harness(input,{reserveResult:{created:false}});
 assert.equal((await executeGitHubOperation(input,duplicate.services)).state,'reconcile-required');
 assert.equal(duplicate.calls.filter(call=>call.method!=='GET').length,0);

 for(const options of [
  {mutateThrows:true},{mutateStatus:403},{afterSetting:false},{markFailure:true},
 ]){
  const run=harness(input,options),result=await executeGitHubOperation(input,run.services);
  assert.equal(result.state,'reconcile-required');
  assert.equal(run.calls.filter(call=>call.method==='PATCH').length,1);
  if(options.markFailure)assert.equal(result.ledgerMarkFailed,true);
 }
});

test('workflow controls exclude nonexistent workflows and never disable core Verify',()=>{
 for(const input of [
  plan('actions.disable',{params:{workflow:'verify.yml'},expected:{state:'active'}}),
  plan('actions.enable',{params:{workflow:'continuum-council-supervisor.yml'},
   expected:{state:'disabled_manually'}}),
 ]) assert.throws(()=>validateGitHubOperationPlan(input,NOW),/scope mismatch/);
});
