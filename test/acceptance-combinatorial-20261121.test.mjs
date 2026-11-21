import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';
import {normalizeDeploymentReceiptRequest,deploymentArtifactDigest}
 from '../cloud/hatchable/lib/deployment-release-receipt/read.js';

// 16,384 distinct deterministic OFFLINE vectors, no network, provider calls,
// production database, signing keys, tokens, or external LLM inference.
const N=4096,M=2048,at=Date.parse('2026-11-21T20:00:00.000Z');
const sha1=x=>createHash('sha1').update(String(x)).digest('hex');
const sha256=x=>createHash('sha256').update(String(x)).digest('hex');
function repair(i){
 return {
  id:'repair-matrix-'+String(i).padStart(5,'0'),
  owner:'michaeljwilliams0123',
  repository:'michaeljwilliams0123/Ultron.MW',
  branch:'ultron/repair-matrix-'+i.toString(36),
  baseSha:sha1('base:'+i),
  objective:'Reconcile a bounded deterministic owner-scoped repair #'+i,
  allowedPaths:[i%2?'src/matrix.mjs':'test/matrix.test.mjs'],
  maxAttempts:1+i%3,maxPaidCents:0,paidFallback:false,
  expiresAt:new Date(at+60000+i).toISOString()
 };
}
function receipt(i){
 return {key:'release-v142-matrix-'+i,target:'hatchable-v142',
  sourceSha:sha1('source:'+i),
  artifactDigest:'sha256:'+sha256('artifact:'+i),
  manifestFileCount:267,independentReadback:true};
}
test('4096 unique valid repair plans bind correct immutable authority and fingerprints',()=>{
 const keys=new Set();
 for(let i=0;i<N;i++){
  const p=createAutonomousRepairPlan(repair(i),at);
  assert.equal(p.maxPaidCents,0);
  assert.equal(p.paidFallback,false);
  assert.equal(p.owner,'michaeljwilliams0123');
  assert.equal(p.repository,'michaeljwilliams0123/Ultron.MW');
  assert.equal(p.fingerprint,createAutonomousRepairPlan(repair(i),at).fingerprint);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.allowedPaths));
  keys.add(p.fingerprint);
 }
 assert.equal(keys.size,N);
});
test('4096 distinct invalid mutation combinations reject before any repair effect',()=>{
 for(let i=0;i<N;i++){
  const p=repair(i);
  switch(i%16){
   case 0:p.owner='unverified-actor';break;
   case 1:p.repository='other/private-repository';break;
   case 2:p.branch='main';break;
   case 3:p.allowedPaths=['.github/workflows/verify.yml'];break;
   case 4:p.maxPaidCents=1;break;
   case 5:p.paidFallback=true;break;
   case 6:p.maxAttempts=4;break;
   case 7:p.expiresAt=new Date(at-1).toISOString();break;
   case 8:p.baseSha='bad-head';break;
   case 9:p.ownerGrant=true;break;
   case 10:p.allowedPaths=[...p.allowedPaths,...p.allowedPaths];break;
   case 11:p.objective='';break;
   case 12:p.id='Invalid-'+i;break;
   case 13:p.allowedPaths=['src/../escape.mjs'];break;
   case 14:p.expiresAt=new Date(at+86400001).toISOString();break;
   case 15:delete p.allowedPaths;break;
  }
  assert.throws(()=>createAutonomousRepairPlan(p,at),/autonomous-repair-plan-invalid/);
 }
});
test('2048 deployment artifact digests are order-independent for exact file set',()=>{
 for(let i=0;i<M;i++){
  const files=['src','lib','public'].map((prefix,j)=>({
   path:prefix+'/matrix-'+i+'-'+j+'.js',
   hash:sha256(prefix+':'+i+':'+j)
  }));
  const digest=deploymentArtifactDigest(files);
  assert.match(digest,/^sha256:[a-f0-9]{64}$/);
  assert.equal(digest,deploymentArtifactDigest([files[2],files[0],files[1]]));
 }
});
test('2048 manifests with duplicated file path fail before release digest promotion',()=>{
 for(let i=0;i<M;i++){
  const h=sha256('dup:'+i);
  assert.throws(()=>deploymentArtifactDigest([
   {path:'lib/duplicate-'+i+'.js',hash:h},
   {path:'lib/duplicate-'+i+'.js',hash:sha256('changed:'+i)}
  ]),/deployment-files-invalid/);
 }
});
test('2048 unique v142 receipt descriptors are bounded and immutable',()=>{
 for(let i=0;i<M;i++){
  const raw=receipt(i),normalized=normalizeDeploymentReceiptRequest(raw);
  assert.deepEqual(normalized,raw);
  assert.ok(Object.isFrozen(normalized));
 }
});
test('2048 unsafe or ambiguous receipt descriptors fail closed',()=>{
 for(let i=0;i<M;i++){
  const r=receipt(i);
  switch(i%8){
   case 0:r.target='hatchable-latest';break;
   case 1:r.sourceSha='different-sha';break;
   case 2:r.ownerSigned=true;break;
   case 3:r.independentReadback=false;break;
   case 4:r.manifestFileCount=5001;break;
   case 5:r.key='Invalid-Receipt-'+i;break;
   case 6:r.artifactDigest='sha256:incorrect';break;
   case 7:delete r.target;break;
  }
  assert.equal(normalizeDeploymentReceiptRequest(r),null);
 }
});
