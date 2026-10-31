import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executeAdminOperation, validateAdminPlan, ADMIN_OPERATIONS} from '../src/admin-executor.mjs';

const NOW='2026-10-31T20:00:00Z';
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA='a'.repeat(40);
const base=(operation='actions.rerun_failed',params={runId:15})=>({
 schema:'ultron.admin.plan.v1',owner:'michaeljwilliams0123',repository:REPO,
 operation,params,expected:{runAttempt:1,headSha:SHA,conclusion:'failure'},
 idempotencyKey:'admin:task-169-00000001',expiresAt:'2026-10-31T20:05:00Z',maxCostCents:0,
});
const digest=plan=>createHash('sha256').update(JSON.stringify(plan)).digest('hex');
function harness(plan,{readback,approval,identity,occupied=false,mutateFailure=false}={}){
 const calls=[],records=[];
 const actor=identity??{source:'github-installation-token-readback',verified:true,
  principal:'admin-app',repository:REPO,repositoryId:1424939667,installationId:444,
  actorRef:'github-app:ultron-admin',expiresAt:'2026-10-31T20:12:00Z',
  permissions:{metadata:'read',actions:'write',administration:'write',webhooks:'write'}};
 const services={
  clock:()=>NOW,
  control:{read:async()=>({paused:false,revoked:false})},
  identity:{read:async()=>actor},
  authority:{verify:async(received,d)=>approval??({
   source:'independent-owner-authorization',verified:true,actor:'michaeljwilliams0123',
   planDigest:d,grantId:'grant-admin-169',expiresAt:'2026-10-31T20:10:00Z'})},
  ledger:{
   reserve:async entry=>{records.push(['reserve',entry]);return {created:!occupied};},
   mark:async entry=>{records.push(['mark',entry]);}
  },
  github:{
   request:async(method,path,data)=>{
    calls.push({method,path,data});
    if(method==='GET')return (Array.isArray(readback)?readback.shift():readback)??{path:'.github/workflows/verify.yml',status:'completed',conclusion:'failure',run_attempt:1,head_sha:SHA};
    if(mutateFailure)throw Error('network timeout after possible write');
    return {status:201};
   }
  },
 };
 return {services,calls,records};
}
test('support broad but explicitly enumerated GitHub admin verbs',()=>{
 assert.ok(ADMIN_OPERATIONS.includes('actions.dispatch'));
 assert.ok(ADMIN_OPERATIONS.includes('actions.rerun_failed'));
 assert.ok(ADMIN_OPERATIONS.includes('actions.cancel'));
 assert.ok(ADMIN_OPERATIONS.includes('actions.enable'));
 assert.ok(ADMIN_OPERATIONS.includes('actions.disable'));
 assert.ok(ADMIN_OPERATIONS.includes('repository.settings.update'));
 assert.ok(ADMIN_OPERATIONS.includes('webhooks.ping'));
 assert.ok(!ADMIN_OPERATIONS.includes('repository.protection.bypass'));
});
test('successful failed-run retry performs read-before-write and persists action receipt',async()=>{
 const plan=base();
 const {services,calls,records}=harness(plan);
 const r=await executeAdminOperation(plan,services);
 assert.equal(r.state,'dispatched-unverified');
 assert.deepEqual(calls.map(x=>x.method),['GET','POST']);
 assert.match(calls[1].path,/actions\/runs\/15\/rerun-failed-jobs$/);
 assert.equal(records[0][0],'reserve');
 assert.equal(records[1][0],'mark');
});
test('duplicate request is reconciled without repeating an external write',async()=>{
 const plan=base(),{services,calls}=harness(plan,{occupied:true});
 const r=await executeAdminOperation(plan,services);
 assert.equal(r.state,'reconcile-required');
 assert.equal(calls.filter(x=>x.method!=='GET').length,0);
});
test('network timeout after possible write stays uncertain and is never automatically retried',async()=>{
 const plan=base(),{services,calls,records}=harness(plan,{mutateFailure:true});
 const r=await executeAdminOperation(plan,services);
 assert.equal(r.state,'reconcile-required');
 assert.equal(calls.filter(x=>x.method==='POST').length,1);
 assert.match(records.at(-1)[1].state,/reconcile-required/);
});
test('reject forged, expired and mismatched owner authorization before dispatch',async()=>{
 const plan=base();
 for(const approval of [
  {source:'model-generated',verified:true,actor:'michaeljwilliams0123',planDigest:digest(plan),expiresAt:'2026-10-31T20:10:00Z'},
  {source:'independent-owner-authorization',verified:true,actor:'michaeljwilliams0123',planDigest:'0'.repeat(64),expiresAt:'2026-10-31T20:10:00Z'},
  {source:'independent-owner-authorization',verified:true,actor:'michaeljwilliams0123',planDigest:digest(plan),expiresAt:'2026-10-31T19:00:00Z'},
 ]){
  const {services,calls}=harness(plan,{approval});
  await assert.rejects(executeAdminOperation(plan,services),/authorization/);
  assert.equal(calls.length,0);
 }
});
test('deny repair-app, wrong repo and missing operation-specific permission',async()=>{
 const plan=base();
 for(const actor of [
  {source:'github-installation-token-readback',verified:true,principal:'repair-app',repository:REPO,repositoryId:1424939667,installationId:1,actorRef:'github-app:repair',expiresAt:'2026-10-31T20:10:00Z',permissions:{actions:'write'}},
  {source:'github-installation-token-readback',verified:true,principal:'admin-app',repository:'other/repo',repositoryId:1424939667,installationId:1,actorRef:'github-app:admin',expiresAt:'2026-10-31T20:10:00Z',permissions:{actions:'write'}},
  {source:'github-installation-token-readback',verified:true,principal:'admin-app',repository:REPO,repositoryId:1424939667,installationId:1,actorRef:'github-app:admin',expiresAt:'2026-10-31T20:10:00Z',permissions:{metadata:'read'}},
 ]){
  const {services,calls}=harness(plan,{identity:actor});
  await assert.rejects(executeAdminOperation(plan,services),/identity|permission/i);
  assert.equal(calls.length,0);
 }
});
test('reject changed head, wrong conclusion, wrong run attempt before retry',async()=>{
 const plan=base();
 for(const readback of [
  {status:'completed',conclusion:'success',run_attempt:1,head_sha:SHA},
  {status:'completed',conclusion:'failure',run_attempt:2,head_sha:SHA},
  {status:'completed',conclusion:'failure',run_attempt:1,head_sha:'b'.repeat(40)},
 ]){
  const {services,calls}=harness(plan,{readback});
  await assert.rejects(executeAdminOperation(plan,services),/precondition/);
  assert.equal(calls.filter(x=>x.method!=='GET').length,0);
 }
});
test('reject unapproved repo admin settings and no unbounded payload',()=>{
 for(const plan of [
  {...base('repository.settings.update',{setting:'visibility',value:'private'}),expected:{value:'public'}},
  {...base('repository.settings.update',{setting:'allow_squash_merge',value:false}),expected:{value:true},maxCostCents:10},
  {...base(),repository:'other/repo'},
  {...base(),expiresAt:'2026-11-08T20:00:00Z'},
  {...base(),params:{runId:15,secret:'token'}},
 ]){
  assert.throws(()=>validateAdminPlan(plan,NOW),/plan|operation|scope|cost|expiry/i);
 }
});
test('reversible repo setting writes only when exact before-value matches',async()=>{
 const plan={...base('repository.settings.update',{setting:'delete_branch_on_merge',value:true}),expected:{value:false}};
 const {services,calls,records}=harness(plan,{readback:[{delete_branch_on_merge:false},{delete_branch_on_merge:true}]});
 const result=await executeAdminOperation(plan,services);
 assert.equal(result.state,'verified');
 assert.deepEqual(calls.map(x=>x.method),['GET','PATCH','GET']);
 assert.deepEqual(calls[1].data,{delete_branch_on_merge:true});
 assert.equal(records.at(-1)[1].state,'verified');
});
test('workflow dispatch cannot target arbitrary workflow or refs',()=>{
 const good={...base('actions.dispatch',{workflow:'verify.yml',ref:'main'}),expected:{}};
 assert.doesNotThrow(()=>validateAdminPlan(good,NOW));
 for(const params of [{workflow:'../secrets.yml',ref:'main'},{workflow:'verify.yml',ref:'untrusted'},{workflow:'evil.yml',ref:'main'}]){
  assert.throws(()=>validateAdminPlan({...good,params},NOW),/plan|operation|scope/);
 }
});
test('pause, revoked and unavailable control denies before external mutations',async()=>{
 for(const state of [{paused:true,revoked:false},{paused:false,revoked:true}]){
  const plan=base(),{services,calls}=harness(plan);
  services.control.read=async()=>state;
  await assert.rejects(executeAdminOperation(plan,services),/paused|revoked/);
  assert.equal(calls.length,0);
 }
});

test('council dispatch binds an exact issue number and required inputs',async()=>{
 const plan={...base('actions.dispatch',{workflow:'council-debate.yml',ref:'main',itemNumber:183}),expected:{}};
 const {services,calls}=harness(plan,{readback:{state:'active'}});
 const out=await executeAdminOperation(plan,services);
 assert.equal(out.state,'dispatched-unverified');
 assert.deepEqual(calls[1].data,{ref:'main',inputs:{item_number:'183',is_pr:'false'}});
 for(const params of [
  {workflow:'council-debate.yml',ref:'main'},
  {workflow:'council-debate.yml',ref:'main',itemNumber:-1},
  {workflow:'verify.yml',ref:'main',itemNumber:183},
 ]){
  assert.throws(()=>validateAdminPlan({...plan,params},NOW),/plan|scope|operation/);
 }
});
test('Admin v1 does not disable mandatory core Verify workflow',()=>{
 const plan={...base('actions.disable',{workflow:'verify.yml'}),expected:{state:'active'}};
 assert.throws(()=>validateAdminPlan(plan,NOW),/plan|scope|operation/);
});


test('rerun and cancel are denied for non-allowlisted workflow runs before any admin mutation',async()=>{
 for(const [operation,expected] of [
  ['actions.rerun_failed',{runAttempt:1,headSha:SHA,conclusion:'failure'}],
  ['actions.cancel',{runAttempt:1,headSha:SHA,status:'in_progress'}]
 ]){
  const input={...base(operation),expected};
  for(const path of ['.github/workflows/untrusted-deploy.yml','other/verify.yml',null]){
   const readback={path,status:operation==='actions.cancel'?'in_progress':'completed',
    conclusion:'failure',run_attempt:1,head_sha:SHA};
   const {services,calls,records}=harness(input,{readback});
   await assert.rejects(executeAdminOperation(input,services),/precondition/i);
   assert.equal(calls.filter(x=>x.method!=='GET').length,0);
   assert.equal(records.length,0);
  }
 }
});
