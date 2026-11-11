import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judgeIdentityProof,proveIdentity,expectedIdentity} from '../scripts/council-identity-proof.mjs';
import {legacyView} from './workflow-lane-view.mjs';

const marker='council-identity-proof:builder:abc';
const good={id:7,body:'x <!-- '+marker+' -->',user:{login:'ultron-mw-builder-v2[bot]',type:'Bot',id:9},
 performed_via_github_app:{slug:'ultron-mw-builder-v2',id:5633654},html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/issues/1#issuecomment-7',created_at:'t'};

test('expected identity is bound to the observed App ID and transition slug',()=>{
 assert.equal(expectedIdentity('Builder',{appId:5633654,appSlug:'ultron-mw-builder-v2'}).botLogin,
  'ultron-mw-builder-v2[bot]');
 assert.equal(expectedIdentity('Builder',{appId:5633654,appSlug:'ultron-coordinator'}).botLogin,
  'ultron-coordinator[bot]');
 assert.throws(()=>expectedIdentity('Builder',{appId:1,appSlug:'ultron-mw-builder-v2'}),/identity-mismatch/);
 assert.throws(()=>expectedIdentity('Builder',{appId:5633654,appSlug:'attacker-chosen'}),/identity-mismatch/);
 assert.throws(()=>expectedIdentity('Nope'),/role-invalid/);
});
test('bot-authored readback via expected App is authenticated',()=>{
 const r=judgeIdentityProof({role:'Builder',posted:{id:7},readback:good,marker});
 assert.equal(r.authenticated,true);
 assert.equal(r.independentReview,false);
});
test('github-actions authorship is never authenticated',()=>{
 const bad={...good,user:{login:'github-actions[bot]',type:'Bot',id:1},performed_via_github_app:null};
 const r=judgeIdentityProof({role:'Builder',posted:{id:7},readback:bad,marker});
 assert.equal(r.authenticated,false);
 assert.equal(r.evidence,null);
});
test('wrong app slug or missing marker fails',()=>{
 assert.equal(judgeIdentityProof({role:'Builder',posted:{id:7},readback:{...good,performed_via_github_app:{slug:'other',id:1}},marker}).authenticated,false);
 assert.equal(judgeIdentityProof({role:'Builder',posted:{id:7},readback:{...good,performed_via_github_app:{slug:'ultron-mw-builder-v2',id:1}},marker}).authenticated,false);
 assert.equal(judgeIdentityProof({role:'Builder',posted:{id:7},readback:{...good,user:{...good.user,login:'ultron-mw-builder[bot]'}},marker}).authenticated,false);
 assert.equal(judgeIdentityProof({role:'Builder',posted:{id:7},readback:{...good,body:'nope'},marker}).authenticated,false);
});
test('proveIdentity posts then reads back; http failure throws',async()=>{
 const calls=[];
 const f=async(u,o)=>{calls.push(o.method);return{ok:true,json:async()=>o.method==='POST'?{id:7}:{...good,body:'<!-- '+marker+' -->'}}};
 const r=await proveIdentity({role:'Builder',token:'t',issueNumber:1,runUrl:'u',sha:'s',fetchImpl:async(u,o)=>{
  const res=await f(u,o);return res;}});
 assert.deepEqual(calls,['POST','GET']);
 assert.equal(typeof r.authenticated,'boolean');
 await assert.rejects(proveIdentity({role:'Builder',token:'t',issueNumber:1,runUrl:'u',sha:'s',fetchImpl:async()=>({ok:false,status:403})}),/github-403/);
 await assert.rejects(proveIdentity({role:'Builder',issueNumber:1}),/input-invalid/);
});
test('workflow is owner-gated and SHA-pinned, shares only the Coordinator App identity',()=>{
 const y=legacyView('council-identity-proof.yml');
 assert.match(y,/create-github-app-token@[0-9a-f]{40}/);
 assert.match(y,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(y,/vars\.ULTRON_BUILDER_CLIENT_ID/);
 assert.match(y,/secrets\.ULTRON_BUILDER_PRIVATE_KEY/);
 assert.doesNotMatch(y,/ULTRON_\{0\}_PRIVATE_KEY|permission-pull-requests: write/);
 assert.match(y,/github\.repository_id == 1424939667/);
 assert.match(y,/github\.repository_owner_id == 308995719/);
 assert.match(y,/github\.triggering_actor == 'michaeljwilliams0123'/);
 assert.match(y,/cancel-in-progress: false/);
 assert.match(y,/ACTUAL_APP_SLUG.*steps\.app\.outputs\.app-slug/);
 assert.match(y,/permission-issues: write/);
 assert.doesNotMatch(y,/COUNCIL_APP_SLUG/);
 assert.doesNotMatch(y,/echo .*token/i);
 for(const m of y.matchAll(/uses: (\S+)@(\S+)/g))assert.match(m[2],/^[0-9a-f]{40}$/);
});

test('role proof readback from shared Coordinator attributes distinct logical roles but never independent approval',()=>{
 const readback={...good,user:{login:'ultron-coordinator[bot]',type:'Bot',id:353078104},
  performed_via_github_app:{slug:'ultron-coordinator',id:5633654}};
 for(const role of ['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']){
  const result=judgeIdentityProof({role,posted:{id:7},readback,marker});
  assert.equal(result.authenticated,true);
  assert.equal(result.evidence.appId,5633654);
  assert.equal(result.independentReview,false);
 }
 const forged={...readback,performed_via_github_app:{slug:'ultron-coordinator',id:5633655}};
 assert.equal(judgeIdentityProof({role:'Sentinel',posted:{id:7},
  readback:forged,marker}).authenticated,false);
});
