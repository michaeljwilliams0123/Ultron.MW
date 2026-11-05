import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judgeIdentityProof,proveIdentity,expectedIdentity} from '../scripts/council-identity-proof.mjs';

const marker='council-identity-proof:builder:abc';
const good={id:7,body:'x <!-- '+marker+' -->',user:{login:'ultron-mw-builder[bot]',type:'Bot',id:9},
 performed_via_github_app:{slug:'ultron-mw-builder',id:3},html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/issues/1#issuecomment-7',created_at:'t'};

test('expected identity derives from role',()=>{
 assert.equal(expectedIdentity('Builder').botLogin,'ultron-mw-builder[bot]');
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
test('workflow is owner-gated, SHA-pinned, uses create-github-app-token v3 with per-role secrets',()=>{
 const y=readFileSync(new URL('../.github/workflows/council-identity-proof.yml',import.meta.url),'utf8');
 assert.match(y,/create-github-app-token@[0-9a-f]{40}/);
 assert.match(y,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(y,/ULTRON_\{0\}_PRIVATE_KEY/);
 assert.doesNotMatch(y,/echo .*token/i);
 for(const m of y.matchAll(/uses: (\S+)@(\S+)/g))assert.match(m[2],/^[0-9a-f]{40}$/);
});
