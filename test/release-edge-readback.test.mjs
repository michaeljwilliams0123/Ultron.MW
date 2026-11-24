import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeEdgeReleaseReadback,projectEdgeReleaseProof} from '../cloud/hatchable/lib/release-proof-edge-auth.js';
import {readCanonicalReleaseProof} from '../cloudflare/edge-shield/src/release-readback.ts';
const now=Date.parse('2026-11-24T22:00:00Z');
const secret='fixture-only-'+ 'x'.repeat(40);
const origin='https://ultron-mw-cloud.hatchable.site';
const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
const proof={schema:'ultron.release-proof.v1',repo:'michaeljwilliams0123/Ultron.MW',commitSha:sha,
 verified:true,status:'verified',ci:{verified:true},council:{verified:true},
 deployment:{verified:true,target:'hatchable-v999',sourceSha:sha,artifactDigest:digest,receiptId:'deployment:42'},
 evidenceSha256:'c'.repeat(64),driftDetails:{ciVerified:true,councilVerified:true,deploymentReceiptRecorded:true,independentManifestReadback:true,missingGates:[]}};
test('canonical edge readback is authenticated and exposes only independently observed evidence',async()=>{
 let calls=0;
 const p=await readCanonicalReleaseProof({origin,secret,now,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,origin+'/api/brain/release-proof-edge');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now,method:options.method}),true);
  return new Response(JSON.stringify(projectEdgeReleaseProof(proof)),{status:200});
 }});
 assert.equal(calls,1);assert.equal(p.verified,true);assert.equal(p.commitSha,sha);assert.equal(p.receiptId,'deployment:42');
 assert.equal(Object.hasOwn(p,'grant'),false);assert.equal(Object.hasOwn(p,'council'),false);
});
test('wrong key, expired signature and non-GET calls cannot authenticate',async()=>{
 await readCanonicalReleaseProof({origin,secret,now,fetchImpl:async(url,options)=>{
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret:'wrong-'+secret,now,method:'GET'}),false);
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now:now+61000,method:'GET'}),false);
  assert.equal(await authorizeEdgeReleaseReadback({headers:options.headers,secret,now,method:'POST'}),false);
  return new Response(JSON.stringify(projectEdgeReleaseProof(proof)),{status:200});
 }});
});
test('missing durable receipt or manifest proof cannot be promoted by the edge',async()=>{
 for(const candidate of [{...proof,verified:false},{...proof,deployment:{...proof.deployment,receiptId:null}},
  {...proof,driftDetails:{...proof.driftDetails,independentManifestReadback:false}},
  {...proof,deployment:{...proof.deployment,sourceSha:'d'.repeat(40)}}]){
  assert.equal(projectEdgeReleaseProof(candidate).verified,false);
 }
 const held=await readCanonicalReleaseProof({origin,secret,now,fetchImpl:async()=>new Response(JSON.stringify(projectEdgeReleaseProof({...proof,verified:false})),{status:200})});
 assert.equal(held.verified,false);
});
test('foreign origin, missing secret and malformed proof fail closed',async()=>{
 let calls=0;
 for(const args of [{origin:'https://other.invalid',secret},{origin,secret:''}]){
  await assert.rejects(readCanonicalReleaseProof({...args,now,fetchImpl:async()=>{calls++;throw Error('unexpected')}}));
 }
 assert.equal(calls,0);
 await assert.rejects(readCanonicalReleaseProof({origin,secret,now,fetchImpl:async()=>new Response(JSON.stringify({verified:true}),{status:200})}));
});
test('both owner and service read-only routes use canonical readback, without receipt submission authority',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const owner=read('cloud/hatchable/api/brain/release-proof.js'),edge=read('cloud/hatchable/api/brain/release-proof-edge.js');
 assert.match(owner,/access='admin'/);assert.match(owner,/readCanonicalReleaseProof/);
 assert.match(edge,/methods=\['GET'\]/);assert.match(edge,/authorizeEdgeReleaseReadback/);assert.match(edge,/readCanonicalReleaseProof/);
 assert.doesNotMatch(edge,/submitDeploymentReleaseReceipt|verifyDelegatedGrant|brain_authority_grants/);
 const workflow=read('cloudflare/edge-shield/src/workflows/release-proof.ts');
 assert.match(workflow,/readCanonicalReleaseProof/);assert.match(workflow,/if \(!proof\.verified\)/);
});
