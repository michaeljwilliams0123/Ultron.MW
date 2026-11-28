import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNCIL_APP_ROLES,authenticateCouncilAppActor,decideCouncilAction} from '../src/council-app-identities.mjs';
import {executeMemberAction,memberAbilityAdmission} from '../src/council-members.mjs';

const repo='michaeljwilliams0123/Ultron.MW';
const sha='a'.repeat(40),other='b'.repeat(40);
const grants={metadata:'read',administration:'write',actions:'write',contents:'write',workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write',deployments:'write',environments:'write',secrets:'write'};
const ops=['pr.merge','protected-main.update','workflow.update','secret.put','secret.delete','deployment.create','repo.settings.update'];
const request=operation=>({operation,repository:repo,baseSha:sha,maxPaidCents:0,attempt:1,branch:'main',path:operation==='workflow.update'?'.github/workflows/verify.yml':'src/example.mjs',ref:sha,prAuthor:'fixture-human'});
const actorFor=(role,profile='owner-equivalent',patch={})=>{
 const index=COUNCIL_APP_ROLES.indexOf(role);
 const id=1000+index;
 return authenticateCouncilAppActor({role,sourceSha:sha,installationToken:'fixture-token-not-real',expectedAppId:id,profile,githubProbe:async()=>({source:'github-installations-api',app_id:id,id:2000+index,app_slug:'ultron-mw-'+role.toLowerCase(),repositories:[repo],permissions:grants,...patch})});
};
for(const role of COUNCIL_APP_ROLES){
 for(const op of ops){
  test(role+' / '+op+' / authenticated fixture policy admission',async()=>{
   const actor=await actorFor(role);
   assert.equal(memberAbilityAdmission(role,op,'owner-equivalent').allowed,true);
   assert.equal(decideCouncilAction(actor,request(op)).allowed,true);
  });
  test(role+' / '+op+' / scoped profile denied despite broad observed grants',async()=>{
   const actor=await actorFor(role,'scoped');
   assert.equal(memberAbilityAdmission(role,op,'scoped').allowed,false);
   assert.equal(decideCouncilAction(actor,request(op)).allowed,false);
  });
  test(role+' / '+op+' / cloned actor denied',async()=>{
   const actor=await actorFor(role);
   assert.equal(decideCouncilAction({...actor},request(op)).reason,'identity-or-scope-unverified');
  });
  for(const [label,patch] of [['foreign repository',{repository:'other/repo'}],['changed source',{baseSha:other}],['paid request',{maxPaidCents:1}],['exhausted attempt',{attempt:4}]]){
   test(role+' / '+op+' / '+label,async()=>{
    const actor=await actorFor(role);
    assert.equal(decideCouncilAction(actor,{...request(op),...patch}).allowed,false);
   });
  }
 }
 for(const operation of ['review.comment','review.request-changes','review.approve']){
  test(role+' / '+operation+' / own bot review denied',async()=>{
   const actor=await actorFor(role);
   assert.equal(decideCouncilAction(actor,{...request(operation),prAuthor:actor.botLogin.toUpperCase()}).reason,'self-review-denied');
  });
 }
 for(const permission of ['administration','workflows','secrets','deployments']){
  test(role+' / absent '+permission+' permission prevents owner-admin authentication',async()=>{
   const permissions={...grants};delete permissions[permission];
   await assert.rejects(actorFor(role,'owner-equivalent',{permissions}),/council-permission-missing/);
  });
 }
}

// RED: exact-effect contracts, tested using only an injected local transport.
// These tests deliberately remain failing until the admin executor is hardened.
function transport(){
 const calls=[];
 const fetchImpl=async(url,init={})=>{
  calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):undefined});
  return {ok:true,status:200,json:async()=>({merged:true,sha,object:{sha:other},tree:{sha:other}})};
 };
 return {calls,fetchImpl};
}
test('RED: squash merge must pin the exact authorized head or deny before mutation',async()=>{
 const actor=await actorFor('Builder');const {calls,fetchImpl}=transport();
 const r=await executeMemberAction(actor,'fixture-token',{op:'pr.merge'},{number:1,prAuthor:'fixture-human'},{fetchImpl});
 const write=calls.find(c=>c.method==='PUT'&&c.url.endsWith('/merge'));
 if(r.status==='denied')assert.equal(write,undefined);
 else assert.equal(write?.body?.sha,sha);
});
test('RED: deployment must use immutable authorized commit and preserve required checks or deny',async()=>{
 const actor=await actorFor('Builder');const {calls,fetchImpl}=transport();
 const r=await executeMemberAction(actor,'fixture-token',{op:'deployment.create',ref:'main',environment:'fixture'},{number:1},{fetchImpl});
 const write=calls.find(c=>c.method==='POST'&&c.url.endsWith('/deployments'));
 if(r.status==='denied')assert.equal(write,undefined);
 else{
  assert.equal(write?.body?.ref,sha);
  assert.notDeepEqual(write?.body?.required_contexts,[]);
 }
});
test('RED: secret mutation without verified exact effect cannot report completion',async()=>{
 const actor=await actorFor('Builder');const {fetchImpl}=transport();
 const r=await executeMemberAction(actor,'fixture-token',{op:'secret.delete',name:'FIXTURE_ONLY'},{number:1,caseSha:'c'.repeat(64)},{fetchImpl});
 assert.ok(r.status!=='done'||r.receipt,'done must include durable exact-effect evidence');
});
test('RED: approval without verified PR author must deny before mutation',async()=>{
 const actor=await actorFor('Builder');const {calls,fetchImpl}=transport();
 const r=await executeMemberAction(actor,'fixture-token',{op:'review.approve',text:'fixture'},{number:1},{fetchImpl});
 assert.equal(r.status,'denied');
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
});
