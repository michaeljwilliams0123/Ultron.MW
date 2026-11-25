import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldWakeAuthorization, dispatchReleaseAuthorization } from '../cloudflare/edge-shield/src/release-authorization.ts';
const sha='a'.repeat(40), repo='michaeljwilliams0123/Ultron.MW';
const proof={repo,commitSha:sha,verified:false,missingGates:['signed-deployment-receipt','independent-manifest-readback']};
test('only canonical current release with CI and Council satisfied wakes authorization',()=>{
 assert.equal(shouldWakeAuthorization(proof,sha),true);
 for(const p of [{...proof,verified:true},{...proof,repo:'other/repo'},{...proof,missingGates:['ci','signed-deployment-receipt']},{...proof,missingGates:['council-7of7','signed-deployment-receipt']},{...proof,missingGates:['independent-manifest-readback']}]) assert.equal(shouldWakeAuthorization(p,sha),false);
 assert.equal(shouldWakeAuthorization(proof,'b'.repeat(40)),false);
});
test('dispatch sends only a signed canonical SHA; no receipt claims or arbitrary URLs',async()=>{
 let calls=0;
 const result=await dispatchReleaseAuthorization({origin:'https://ultron-mw-cloud.hatchable.site',secret:'x'.repeat(40),sourceSha:sha,now:1795550000000,fetchImpl:async(url,init)=>{
  calls++; assert.equal(url,'https://ultron-mw-cloud.hatchable.site/api/brain/release-authorization-wakeup');
  assert.equal(init.method,'POST'); assert.deepEqual(JSON.parse(init.body),{sourceSha:sha});
  assert.match(init.headers['x-ultron-release-proof-mac'],/^[a-f0-9]{64}$/);
  return new Response(JSON.stringify({status:'dispatched'}),{status:200});
 }});
 assert.equal(result.status,'dispatched');assert.equal(calls,1);
 await assert.rejects(dispatchReleaseAuthorization({origin:'https://other.example',secret:'x'.repeat(40),sourceSha:sha,fetchImpl:()=>{throw Error('must not fetch')}}));
});
test('backup triggers are native, bounded and do not consume untrusted run artifacts',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/release-authorize.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_run:/);assert.match(workflow,/schedule:/);
 assert.match(workflow,/Ultron core verification/);assert.match(workflow,/head_repository\.id/);
 assert.match(workflow,/concurrency:/);assert.doesNotMatch(workflow,/download-artifact/);
});

import {discoverAutonomousReleaseManifest} from '../cloud/hatchable/lib/autonomous-release-manifest.js';
test('manifest discovery uses only the canonical live deployment and independently proves exact source',async()=>{
 const snapshot={status:'live',version:159,file_manifest:[{path:'public/app.js',hash:'f'.repeat(64)}]};
 const list={current_version:159,deployments:[{status:'live',version:159}]};
 const rpc=x=>new Response(JSON.stringify({result:{structuredContent:x}}));
 let reads=0;
 const fetchImpl=async(url,opts)=>{
  assert.equal(url,'https://hatchable.com/mcp');
  const call=JSON.parse(opts.body).params;
  assert.equal(call.arguments.project_id,'proj_A6GCXRSKizko');
  if(call.name==='list_deployments'){reads++;return rpc(list);}
  assert.equal(call.name,'get_deployment');assert.equal(call.arguments.version,159);return rpc(snapshot);
 };
 const config={get:async()=> 'test-token'};
 const verifyInventory=async({sourceSha,files})=>({sourceSha,runId:1,artifactId:2});
 const found=await discoverAutonomousReleaseManifest({config,sourceSha:sha,fetchImpl,verifyInventory});
 assert.equal(found.target,'hatchable-v159');assert.equal(found.manifestFileCount,1);assert.equal(reads,2);
 assert.equal(await discoverAutonomousReleaseManifest({config,sourceSha:sha,fetchImpl,verifyInventory:async()=>null}),null);
 snapshot.source_sha='b'.repeat(40);
 assert.equal(await discoverAutonomousReleaseManifest({config,sourceSha:sha,fetchImpl,verifyInventory}),null);
 delete snapshot.source_sha;
 let n=0;
 const drift=async(url,opts)=>{
  if(JSON.parse(opts.body).params.name==='list_deployments'&&++n===2)return rpc({...list,current_version:160});
  return fetchImpl(url,opts);
 };
 assert.equal(await discoverAutonomousReleaseManifest({config,sourceSha:sha,fetchImpl:drift,verifyInventory}),null);
});
