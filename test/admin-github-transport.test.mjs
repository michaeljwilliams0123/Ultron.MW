import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminGitHubTransport} from '../src/admin-github-transport.mjs';

test('authenticated Admin App transport executes authorized GitHub REST operations',async()=>{
 const calls=[];
 const transport=createAdminGitHubTransport({
  getToken:async()=>({token:'test-only-credential'}),
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   return {ok:true,status:init.method==='GET'?200:201,
    json:async()=>({status:'completed',conclusion:'failure',run_attempt:1})};
  },
 });
 const r=await transport.request('GET','/repos/michaeljwilliams0123/Ultron.MW/actions/runs/15');
 assert.equal(r.status,'completed');
 const m=await transport.request('POST','/repos/michaeljwilliams0123/Ultron.MW/actions/runs/15/rerun-failed-jobs');
 assert.equal(m.status,201);
 assert.equal(calls.length,2);
 assert.equal(calls[0].init.redirect,'error');
 assert.equal(calls[1].init.method,'POST');
 assert.equal(calls[1].init.headers.Authorization,'Bearer test-only-credential');
});
test('reject foreign repository, insecure URLs, unsupported paths and methods',async()=>{
 const transport=createAdminGitHubTransport({
  getToken:async()=>({token:'test-only-credential'}),
  fetchImpl:async()=>{throw Error('unexpected network call');}
 });
 for(const [method,path] of [
  ['POST','/repos/other/repo/actions/runs/15/rerun-failed-jobs'],
  ['DELETE','/repos/michaeljwilliams0123/Ultron.MW'],
  ['POST','https://malicious.example/admin'],
  ['POST','/repos/michaeljwilliams0123/Ultron.MW/actions/secrets'],
  ['POST','/repos/michaeljwilliams0123/Ultron.MW/actions/runs/15/force-cancel'],
 ]){
  await assert.rejects(transport.request(method,path),/path|method|scope|denied/i);
 }
});
test('transport errors redact tokens and reject invalid credential readback',async()=>{
 const transport=createAdminGitHubTransport({
  getToken:async()=>({token:'super-secret-do-not-leak'}),
  fetchImpl:async()=>({ok:false,status:403,json:async()=>({message:'bad'})}),
 });
 await assert.rejects(transport.request('POST','/repos/michaeljwilliams0123/Ultron.MW/actions/runs/15/cancel'),e=>
  e.message.includes('403')&&!e.message.includes('super-secret-do-not-leak'));
 const missing=createAdminGitHubTransport({getToken:async()=>null,fetchImpl:async()=>{}});
 await assert.rejects(missing.request('GET','/repos/michaeljwilliams0123/Ultron.MW'),/credential/i);
});
test('transport treats response loss as failure for executor reconciliation, not as retry',async()=>{
 let calls=0;
 const transport=createAdminGitHubTransport({
  getToken:async()=>({token:'test'}),
  fetchImpl:async()=>{calls++;throw Error('failed network');}
 });
 await assert.rejects(transport.request('POST','/repos/michaeljwilliams0123/Ultron.MW/actions/runs/15/cancel'),/transport/i);
 assert.equal(calls,1);
});
