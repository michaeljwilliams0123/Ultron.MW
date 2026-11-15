import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReleaseProof} from '../src/evidence/release-proof.mjs';

const HEAD='a'.repeat(40),PR=463;
const ci={verified:true,status:'verified',headSha:HEAD,workflowId:388875616,runId:43688109614};
const deployment={target:'hatchable-v117',sourceSha:HEAD,
 artifactDigest:'sha256:'+'b'.repeat(64),receiptId:'pg-release-463',
 independentReadback:true};
const summary=(decision='accepted',approvals='7/7',paths='none')=>[
 '**Decision:** '+decision,'**PR:** #'+PR,'**Head:** '+HEAD,
 '**Role approvals:** '+approvals,'**Held roles:** none',
 '**Model hold/unavailable:** none','**Security-sensitive paths:** '+paths
].join('\n');
const check={id:987654, name:'ultron/council-7of7',head_sha:HEAD,
 status:'completed',conclusion:'success',
 app:{id:5765239,slug:'ultron-council-gate'},
 output:{title:'7/7 Council roles and model reviews on exact head',summary:summary()}};
const args={commitSha:HEAD,ci,councilCheck:check,prNumber:PR,deployment};

test('proof accepts the one trusted Council Gate App with seven logical role approvals',async()=>{
 const r=await buildReleaseProof(args);
 assert.equal(r.verified,true);
 assert.equal(r.council.quorum,'7/7');
 assert.equal(r.council.publisherAppId,5765239);
 assert.equal(r.council.distinctAppIds,1);
 assert.equal(r.council.ownerExceptionUsed,false);
});
test('signed owner exception is a separate mode, never misreported as seven votes',async()=>{
 const r=await buildReleaseProof({...args,councilCheck:{...check,output:{
  title:'Signed owner exception #43210',
  summary:summary('owner-overridden','2/7','src/security/owner-auth.js')
 }}});
 assert.equal(r.verified,true);
 assert.equal(r.council.quorum,'owner-exception');
 assert.equal(r.council.ownerExceptionUsed,true);
});
test('legacy seven-app role fixtures never substitute for a trusted publisher check',async()=>{
 const r=await buildReleaseProof({...args,councilCheck:null,
  councilChecks:Array.from({length:7},(_,i)=>({app:{id:i+1001},conclusion:'success'})),
  expectedAppIds:Object.fromEntries(['architect','security','sre','qa','scope','devils_advocate','judge'].map((x,i)=>[x,i+1001]))});
 assert.equal(r.verified,false);
});
test('wrong App, wrong slug, wrong check name, stale head and red result all hold',async()=>{
 const variants=[
 {...check,app:{id:15368,slug:'github-actions'}},
 {...check,app:{id:5765239,slug:'ultron-coordinator'}},
 {...check,name:'untrusted/council-7of7'},
 {...check,head_sha:'c'.repeat(40)},
 {...check,conclusion:'failure'}
 ];
 for(const councilCheck of variants){
  const r=await buildReleaseProof({...args,councilCheck});
  assert.equal(r.verified,false);
  assert.equal(r.council.quorum,'unverified');
 }
});
test('check body needs matching PR, head, all seven votes and no model or role holds',async()=>{
 const variants=[
 summary().replace('**PR:** #463','**PR:** #462'),
 summary().replace('**Head:** '+HEAD,'**Head:** '+'c'.repeat(40)),
 summary().replace('**Role approvals:** 7/7','**Role approvals:** 6/7'),
 summary().replace('**Held roles:** none','**Held roles:** Skeptic'),
 summary().replace('**Model hold/unavailable:** none','**Model hold/unavailable:** Sentinel'),
 summary().replace('**Security-sensitive paths:** none','**Security-sensitive paths:** .github/workflows/new.yml')
 ];
 for(const s of variants){
  const r=await buildReleaseProof({...args,councilCheck:{...check,output:{...check.output,summary:s}}});
  assert.equal(r.verified,false);
 }
});
test('signed exception must identify a genuine owner-override decision and sensitive change',async()=>{
 for(const output of [
  {title:'Signed owner exception #43210',summary:summary('accepted','7/7')},
  {title:'Signed owner exception #43210',summary:summary('owner-overridden','4/7')},
  {title:'7/7 Council roles and model reviews on exact head',summary:summary('owner-overridden','4/7','src/security/a.js')}
 ]){
  assert.equal((await buildReleaseProof({...args,councilCheck:{...check,output}})).verified,false);
 }
});
test('even a green Council gate never substitutes for CI or deployed exact-byte readback',async()=>{
 const withoutCI=await buildReleaseProof({...args,ci:{...ci,verified:false}});
 const withoutDeployment=await buildReleaseProof({...args,deployment:{...deployment,independentReadback:false}});
 const drift=await buildReleaseProof({...args,deployment:{...deployment,sourceSha:'d'.repeat(40)}});
 assert.equal(withoutCI.verified,false);
 assert.equal(withoutDeployment.verified,false);
 assert.equal(drift.verified,false);
});
test('source and Hatchable release-proof policy remain byte-identical',()=>{
 assert.equal(readFileSync(new URL('../src/evidence/release-proof.mjs',import.meta.url),'utf8'),
 readFileSync(new URL('../cloud/hatchable/lib/release-proof.js',import.meta.url),'utf8'));
});
