import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeEdgeReleaseReadback,projectEdgeReleaseProof} from '../cloud/hatchable/lib/release-proof-edge-auth.js';
import {readCanonicalReleaseProof} from '../cloudflare/edge-shield/src/release-readback.ts';
const now=Date.parse('2026-11-24T22:00:00Z');
const secret='fixture-only-'+'x'.repeat(40);
const origin='https://ultron-mw-cloud.hatchable.site';
const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
const proof={schema:'ultron.release-proof.v1',repo:'michaeljwilliams0123/Ultron.MW',commitSha:sha,
 verified:true,status:'verified',ci:{verified:true},council:{verified:true},
 deployment:{verified:true,target:'hatchable-v999',sourceSha:sha,artifactDigest:digest,receiptId:'deployment:42'},
 evidenceSha256:'c'.repeat(64),driftDetails:{ciVerified:true,councilVerified:true,deploymentReceiptRecorded:true,independentManifestReadback:true,missingGates:[]}};
test('canonical edge readback is authenticated with nonce and rejects replay',async()=>{
 let calls=0,capturedHeaders=null;
 const p=await readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000001',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,origin+'/api/brain/release-proof-edge');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  capturedHeaders=options.headers;
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now,method:options.method}),true);
  return new Response(JSON.stringify(projectEdgeReleaseProof(proof,{now})),{status:200});
 }});
 assert.equal(calls,1);assert.equal(p.verified,true);assert.equal(p.commitSha,sha);assert.equal(p.receiptId,'deployment:42');
 assert.equal(Object.hasOwn(p,'grant'),false);assert.equal(Object.hasOwn(p,'council'),false);
 assert.equal(await authorizeEdgeReleaseReadback({headers:capturedHeaders,secret,now,method:'GET'}),false);
});
test('wrong key, expired signature, missing nonce and non-GET calls cannot authenticate',async()=>{
 await readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000002',fetchImpl:async(url,options)=>{
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret:'wrong-'+secret,now,method:'GET'}),false);
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now:now+61000,method:'GET'}),false);
  assert.equal(await authorizeEdgeReleaseReadback({headers:{'x-ultron-release-proof-ts':options.headers['x-ultron-release-proof-ts'],'x-ultron-release-proof-mac':options.headers['x-ultron-release-proof-mac']},secret,now,method:'GET'}),false);
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now,method:'POST'}),false);
  return new Response(JSON.stringify(projectEdgeReleaseProof(proof,{now})),{status:200});
 }});
});
test('missing durable receipt or manifest proof cannot be promoted by the edge',async()=>{
 for(const candidate of [{...proof,verified:false},{...proof,deployment:{...proof.deployment,receiptId:null}},
  {...proof,driftDetails:{...proof.driftDetails,independentManifestReadback:false}},
  {...proof,deployment:{...proof.deployment,sourceSha:'d'.repeat(40)}}]){
  assert.equal(projectEdgeReleaseProof(candidate,{now}).verified,false);
 }
 const held=await readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000003',fetchImpl:async()=>new Response(JSON.stringify(projectEdgeReleaseProof({...proof,verified:false},{now})),{status:200})});
 assert.equal(held.verified,false);
});
test('foreign origin, missing secret, malformed, stale and future proofs fail closed',async()=>{
 let calls=0;
 for(const args of [{origin:'https://other.invalid',secret},{origin,secret:''}]){
  await assert.rejects(readCanonicalReleaseProof({...args,now,nonce:'nonce-unique-00000004',fetchImpl:async()=>{calls++;throw Error('unexpected')}}));
 }
 assert.equal(calls,0);
 await assert.rejects(readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000005',fetchImpl:async()=>new Response(JSON.stringify({verified:true}),{status:200})}));
 await assert.rejects(readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000006',fetchImpl:async()=>new Response(JSON.stringify(projectEdgeReleaseProof(proof,{now:now-301000})),{status:200})}));
 await assert.rejects(readCanonicalReleaseProof({origin,secret,now,nonce:'nonce-unique-00000007',fetchImpl:async()=>new Response(JSON.stringify(projectEdgeReleaseProof(proof,{now:now+61000})),{status:200})}));
});
test('both owner and service read-only routes use canonical readback, and proxy strips internal headers',async()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const owner=read('cloud/hatchable/api/brain/release-proof.js'),edge=read('cloud/hatchable/api/brain/release-proof-edge.js');
 assert.match(owner,/access='admin'/);assert.match(owner,/readCanonicalReleaseProof/);
 assert.match(edge,/methods=\['GET'\]/);assert.match(edge,/authorizeEdgeReleaseReadback/);assert.match(edge,/readCanonicalReleaseProof/);
 assert.doesNotMatch(edge,/submitDeploymentReleaseReceipt|verifyDelegatedGrant|brain_authority_grants/);
 const proxy=read('cloudflare/edge-shield/src/proxy.ts');
 assert.match(proxy,/x-ultron-release-proof-ts/);
 assert.match(proxy,/x-ultron-release-proof-nonce/);
 assert.match(proxy,/x-ultron-release-proof-mac/);
 const workflow=read('cloudflare/edge-shield/src/workflows/release-proof.ts');
 assert.match(workflow,/readReleaseProofForWorkflow/);assert.match(workflow,/if \(observation.status === "held"\) return observation/);assert.match(workflow,/if \(!proof\.verified\)/);
});

test('quota and authentication failures become held evidence, never a verified proof',async()=>{
 const {readReleaseProofForWorkflow}=await import('../cloudflare/edge-shield/src/release-readback.ts');
 for(const status of [401,403,429]){
  let calls=0;
  const result=await readReleaseProofForWorkflow({origin,secret,now,nonce:'nonce-unique-00000008',fetchImpl:async()=>{calls++;return new Response('untrusted body',{status})}});
  assert.deepEqual(result,{status:'held',reason:status===429?'origin-rate-limited':'origin-authorization-denied',httpStatus:status});
  assert.equal(calls,1);assert.equal(Object.hasOwn(result,'proof'),false);
 }
});
