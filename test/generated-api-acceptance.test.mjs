import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler,integration } from '../src/generated/acceptance/api.mjs';
import { createSigningKey,issueCapabilityToken } from '../src/capability-credentials.mjs';
test('generated api-acceptance exposes authenticated read-only operations',async()=>{
 const key=createSigningKey();
 const githubGet=async path=>path.endsWith('/actions/runs?per_page=3')?{workflow_runs:[]}:
  {full_name:'michaeljwilliams0123/Ultron.MW',private:false,default_branch:'main'};
 const handle=createHandler({signingKey:key,githubGet,now:100});
 const token=issueCapabilityToken({key,audience:'acceptance',now:100,ttlSeconds:300,
  scopes:['status:read','ci:read']});
 const unauth=await handle(new Request('https://example.test/v1/status'));
 assert.equal(unauth.status,401);
 const ok=await handle(new Request('https://example.test/v1/status',{headers:{
 authorization:'Bearer '+token}}));
 assert.equal(ok.status,200);
 assert.equal((await ok.json()).data.name,'michaeljwilliams0123/Ultron.MW');
 const ci=await handle(new Request('https://example.test/v1/ci',{headers:{
 authorization:'Bearer '+token}}));
 assert.equal(ci.status,200);
 const bad=await handle(new Request('https://example.test/execute',{method:'POST'}));
 assert.equal(bad.status,404);
 assert.equal(integration.kind,'api');
});
