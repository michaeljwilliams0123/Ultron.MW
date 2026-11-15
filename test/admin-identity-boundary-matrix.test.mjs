import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {probeGithubAppInstallation, APP_PROOF} from '../src/identity/github-app-installation-proof.mjs';
import {executeAdminOperation, validateAdminPlan} from '../src/admin-executor.mjs';

// Pure fakes: no GitHub credential, production session, external mutation or DB grant.
const NOW='2026-11-14T12:00:00Z';
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA='a'.repeat(40);
const repo={id:1424939667,full_name:REPO,default_branch:'main',owner:{login:'michaeljwilliams0123'}};
const installation={id:179066535,app_id:5633654,account:{login:'michaeljwilliams0123'},
 suspended_at:null,permissions:{metadata:'read',contents:'write',administration:'write',actions:'write',secrets:'write'}};
const token={token:'TEST-INSTALLATION-TOKEN-NEVER-OUTPUT',
 expires_at:'2026-11-14T12:45:00Z',permissions:{metadata:'read'},repositories:[repo]};
const credentials={appId:5633654,installationId:179066535,privateKey:'TEST PRIVATE KEY'};
const response=(status,body)=>({status,json:async()=>body});
function proofHarness({install=installation,repoInstall=installation,minted=token,repository=repo,failAt=0,failStatus=403}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method||'GET',body:options.body,authorization:options.headers.Authorization});
  if(failAt===calls.length)return response(failStatus,{error:'UNTRUSTED-SENSITIVE-DIAGNOSTIC'});
  if(url.endsWith('/app/installations/179066535'))return response(200,install);
  if(url.endsWith('/repos/michaeljwilliams0123/Ultron.MW/installation'))return response(200,repoInstall);
  if(url.endsWith('/app/installations/179066535/access_tokens'))return response(201,minted);
  if(url.endsWith('/repos/michaeljwilliams0123/Ultron.MW'))return response(200,repository);
  throw Error('Unrecognized provider call');
 };
 const run=()=>probeGithubAppInstallation({credentials,signJwt:async()=> 'TEST-JWT-NOT-RETURNED',
  fetchImpl,now:Date.parse(NOW)});
 return {run,calls};
}
const plan=(operation='repository.settings.update')=>({
 schema:'ultron.admin.plan.v1',owner:'michaeljwilliams0123',repository:REPO,
 operation,params:{setting:'allow_squash_merge',value:false},expected:{value:true},
 idempotencyKey:'admin:identity-matrix-000001',expiresAt:'2026-11-14T12:05:00Z',maxCostCents:0
});
const digest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
function adminHarness(p){
 const calls=[],ledger=[];
 const state={time:NOW,control:{paused:false,revoked:false},identity:{
  source:'github-installation-token-readback',verified:true,principal:'admin-app',
  repository:REPO,repositoryId:1424939667,installationId:179066535,
  actorRef:'github-app:ultron-coordinator',expiresAt:'2026-11-14T12:08:00Z',
  permissions:{metadata:'read',administration:'write',actions:'write'}
 },approval:{source:'owner-step-up-authorization',verified:true,actor:'michaeljwilliams0123',
  planDigest:digest(p),grantId:'owner-step-up-grant-123',expiresAt:'2026-11-14T12:04:00Z'},
  before:{allow_squash_merge:true},after:{allow_squash_merge:false},occupied:false};
 const services={
  clock:()=>state.time,
  control:{read:async()=>({...state.control})},
  identity:{read:async()=>({...state.identity,permissions:{...state.identity.permissions}})},
  authority:{verify:async()=>({...state.approval})},
  ledger:{reserve:async record=>{ledger.push(['reserve',record]);return {created:!state.occupied}},
   mark:async record=>{ledger.push(['mark',record])}},
  github:{request:async(method,path,data)=>{
   calls.push({method,path,data});
   if(method==='GET')return calls.filter(x=>x.method==='GET').length===1?state.before:state.after;
   return {status:200};
  }}
 };
 return {state,services,calls,ledger};
}

test('permission lattice reports observation, never administrative authorization',async t=>{
 for(const permission of ['administration','actions','secrets','variables','webhooks']){
  for(const level of ['none','read','write']){
   await t.test(permission+':'+level,async()=>{
    const h=proofHarness({install:{...installation,permissions:{...installation.permissions,[permission]:level}}});
    const proof=await h.run();
    assert.equal(proof.state,'installation-and-scoped-read-verified');
    assert.equal(proof.observedPermissions[permission],level);
    assert.equal(proof.adminOperationVerified,false);
    assert.equal(proof.externalMutationVerified,false);
    assert.equal(proof.productionAccepted,false);
    assert.equal(proof.administrationWritePermissionObserved,permission==='administration'
     ?level==='write':true);
    assert.equal(proof.actionsWritePermissionObserved,permission==='actions'
     ?level==='write':true);
    assert.deepEqual(JSON.parse(h.calls[2].body),{
     repository_ids:[1424939667],permissions:{metadata:'read'}});
   });
  }
 }
});

test('untrusted permission keys, values and provider diagnostics never leak',async()=>{
 const h=proofHarness({install:{...installation,permissions:{...installation.permissions,
  administration:'admin',webhooks:'write_and_delete',unrecognized:'DO-NOT-RETURN-THIS'}}});
 const proof=await h.run();
 assert.equal(proof.observedPermissions.administration,'none');
 assert.equal(proof.observedPermissions.webhooks,'none');
 assert.equal(Object.hasOwn(proof.observedPermissions,'unrecognized'),false);
 assert.doesNotMatch(JSON.stringify(proof),/DO-NOT-RETURN-THIS|TEST-INSTALLATION-TOKEN|PRIVATE KEY/);
});

test('all four provider steps are fail closed under rejected and throttled responses',async t=>{
 const reasons=['installation-mismatch','repository-installation-mismatch',
  'token-scope-mismatch','repository-readback-mismatch'];
 for(const status of [401,403,429,500,503]){
  for(let step=1;step<=4;step++){
   await t.test('step '+step+' HTTP '+status,async()=>{
    const h=proofHarness({failAt:step,failStatus:status});
    const proof=await h.run();
    assert.equal(proof.state,'unverified');
    assert.equal(proof.reason,reasons[step-1]);
    assert.equal(proof.productionAccepted,false);
    assert.equal(h.calls.length,step);
    assert.doesNotMatch(JSON.stringify(proof),/UNTRUSTED-SENSITIVE|TEST-JWT|PRIVATE KEY/);
   });
  }
 }
});

test('wrong App, wrong owner, wrong installation, suspension and reduced scopes fail before token mint',async t=>{
 const variants=[
  {app_id:5722581}, {id:181119149},{account:{login:'michaeljwilliams0123ultron'}},
  {suspended_at:'2026-11-14T00:00:00Z'},
  {permissions:{metadata:'read',contents:'read',administration:'write'}},
  {permissions:{metadata:'none',contents:'write',administration:'write'}}
 ];
 for(const variant of variants){
  await t.test(JSON.stringify(variant),async()=>{
   const h=proofHarness({install:{...installation,...variant}});
   const result=await h.run();
   assert.equal(result.reason,'installation-mismatch');
   assert.equal(h.calls.length,1);
  });
 }
});

test('repository mapping rejects wrong repository or owner before obtaining a token',async t=>{
 for(const variant of [{id:181119149},{app_id:5722581},
  {account:{login:'michaeljwilliams0123ultron'}},
  {suspended_at:'2026-11-14T00:00:00Z'}]){
  await t.test(JSON.stringify(variant),async()=>{
   const h=proofHarness({repoInstall:{...installation,...variant}});
   const result=await h.run();
   assert.equal(result.reason,'repository-installation-mismatch');
   assert.equal(h.calls.length,2);
  });
 }
});

test('the two installation readbacks must not disagree about reported administrative scopes',async()=>{
 const h=proofHarness({repoInstall:{...installation,
  permissions:{...installation.permissions,administration:'read'}}});
 const proof=await h.run();
 assert.equal(proof.state,'unverified');
 assert.equal(proof.administrationWritePermissionObserved,undefined);
 assert.equal(h.calls.length,2);
});

test('scoped token never admits another repository or additional privileges',async t=>{
 const variants=[
  {...token,permissions:{metadata:'read',administration:'write'}},
  {...token,permissions:{metadata:'write'}},
  {...token,repositories:[repo,{...repo,id:1}]},
  {...token,repositories:[{...repo,owner:{login:'michaeljwilliams0123ultron'}}]},
  {...token,expires_at:'2026-11-14T11:59:59Z'},
  {...token,expires_at:'2026-11-14T13:30:00Z'},
  {...token,token:''}
 ];
 for(const variant of variants){
  await t.test(JSON.stringify(Object.keys(variant).filter(k=>JSON.stringify(variant[k])!==JSON.stringify(token[k]))),async()=>{
   const h=proofHarness({minted:variant});
   const result=await h.run();
   assert.equal(result.reason,'token-scope-mismatch');
   assert.equal(h.calls.length,3);
  });
 }
});

test('metadata-only proof cannot be promoted into an execution receipt',async()=>{
 const h=proofHarness();
 const result=await h.run();
 assert.equal(result.observedPermissions.administration,'write');
 assert.equal(result.adminOperationVerified,false);
 assert.equal(result.externalMutationVerified,false);
 assert.equal(result.productionAccepted,false);
 assert.deepEqual(h.calls.map(c=>c.method),['GET','GET','POST','GET']);
 assert.equal(h.calls.filter(c=>c.method==='PATCH'||c.method==='PUT'||c.method==='DELETE').length,0);
});

test('write collaborator or Council principal never becomes the Admin Executor',async t=>{
 for(const principal of ['michaeljwilliams0123ultron','owner','council-app','repair-app']){
  await t.test(principal,async()=>{
   const p=plan(),h=adminHarness(p);
   h.state.identity.principal=principal;
   await assert.rejects(executeAdminOperation(p,h.services),/identity or permission/);
   assert.equal(h.calls.length,0);
   assert.equal(h.ledger.length,0);
  });
 }
});

test('administration-write does not imply Actions-write and vice versa',async()=>{
 const p=plan(),h=adminHarness(p);
 h.state.identity.permissions={metadata:'read',actions:'write'};
 await assert.rejects(executeAdminOperation(p,h.services),/identity or permission/);
 assert.equal(h.calls.length,0);
});

test('owner standing approval cannot substitute for fresh step-up on repository settings',async()=>{
 const p=plan(),h=adminHarness(p);
 h.state.approval.source='owner-standing-authorization';
 await assert.rejects(executeAdminOperation(p,h.services),/authorization/);
 assert.equal(h.calls.length,0);
});

test('expired, wrong-actor, forged-digest, and missing grants cannot reserve writes',async t=>{
 const patches=[
  {actor:'michaeljwilliams0123ultron'},
  {planDigest:'f'.repeat(64)},
  {expiresAt:'2026-11-14T11:59:00Z'},
  {verified:false}, {grantId:''},{source:'council-vote'}
 ];
 for(const patch of patches){
  await t.test(JSON.stringify(patch),async()=>{
   const p=plan(),h=adminHarness(p);
   Object.assign(h.state.approval,patch);
   await assert.rejects(executeAdminOperation(p,h.services),/authorization/);
   assert.equal(h.calls.length,0);
   assert.equal(h.ledger.length,0);
  });
 }
});

test('stale precondition refuses to reserve or perform a repository mutation',async()=>{
 const p=plan(),h=adminHarness(p);
 h.state.before.allow_squash_merge=false;
 await assert.rejects(executeAdminOperation(p,h.services),/precondition/);
 assert.deepEqual(h.calls.map(c=>c.method),['GET']);
 assert.equal(h.ledger.length,0);
});

test('occupied idempotency key must never dispatch a second GitHub write',async()=>{
 const p=plan(),h=adminHarness(p);
 h.state.occupied=true;
 const outcome=await executeAdminOperation(p,h.services);
 assert.equal(outcome.state,'reconcile-required');
 assert.equal(h.calls.filter(c=>c.method!=='GET').length,0);
 assert.equal(h.ledger.filter(entry=>entry[0]==='reserve').length,1);
});

test('a revoked execution identity during reservation must prevent dispatch',async()=>{
 const p=plan(),h=adminHarness(p);
 const reserve=h.services.ledger.reserve;
 h.services.ledger.reserve=async intent=>{
  const claim=await reserve(intent);
  h.state.identity.verified=false;
  h.state.identity.permissions.administration='none';
  return claim;
 };
 const outcome=await executeAdminOperation(p,h.services);
 assert.equal(outcome.state,'reconcile-required');
 assert.equal(h.calls.filter(c=>c.method!=='GET').length,0,
  'identity revocation after reservation must stop privileged dispatch');
});

test('successful reversible settings canary has explicit before, exact patch, after and receipt',async()=>{
 const p=plan(),h=adminHarness(p);
 const outcome=await executeAdminOperation(p,h.services);
 assert.equal(outcome.state,'verified');
 assert.deepEqual(h.calls.map(c=>c.method),['GET','PATCH','GET']);
 assert.deepEqual(h.calls[1].data,{allow_squash_merge:false});
 assert.equal(h.ledger.at(-1)[1].state,'verified');
 assert.equal(outcome.planDigest,digest(p));
});
