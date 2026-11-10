import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAutonomousRepairPlan,runAutonomousRepair} from '../src/autonomous-repair-loop.mjs';

const sha='a'.repeat(40),next='b'.repeat(40),next2='c'.repeat(40);
const now=()=>Date.parse('2026-11-09T20:00:00Z');
function plan(overrides={}){
 return createAutonomousRepairPlan({id:'repair-case-0001',owner:'michaeljwilliams0123',
  repository:'michaeljwilliams0123/Ultron.MW',branch:'ultron/repair-autofix-001',
  baseSha:sha,objective:'Repair the failing repository test without changing release policy',
  allowedPaths:['src/example.mjs'],maxAttempts:3,maxPaidCents:0,paidFallback:false,
  expiresAt:'2026-11-10T20:00:00Z',...overrides},now());
}
function fixture({outcomes=['success'],pending=false,unknownPatch=false,unknownPublish=false}={}){
 const records=new Map(),counts={propose:0,apply:0,observePatch:0,startVerify:0,
  observeVerify:0,startPublish:0,observePublish:0,authorize:0};
 let patchAvailable=!unknownPatch,publicationAvailable=!unknownPublish;
 const ledger={
  async claim(p){let r=records.get(p.id);if(!r){
   r={id:p.id,fingerprint:p.fingerprint,phase:'ready',attempt:0,headSha:p.baseSha,
    manifest:null,patchDigest:null,errorTrace:'',prNumber:null,version:0};
   records.set(p.id,r);
  }return structuredClone(r);},
  async read(id){return structuredClone(records.get(id));},
  async transition({id,fingerprint,from,to,changes}){
   const r=records.get(id);
   if(!r||r.fingerprint!==fingerprint||r.phase!==from)return null;
   r.phase=to;r.version++;
   Object.assign(r,changes);
   return structuredClone(r);
  }
 };
 const generator={async propose({headSha,attempt,previousFailure}){
  counts.propose++; if(attempt>1)assert.match(previousFailure,/FAIL/);
  return {objective:'Fix source',baseSha:headSha,
   changes:[{path:'src/example.mjs',before:'old',after:'new-'+attempt}]};
 }};
 const patcher={async apply(){counts.apply++;patchAvailable=true;
  if(unknownPatch)throw Error('GitHub response lost');},
  async observe({manifest,expectedHeadSha,attempt}){
   counts.observePatch++;
   if(!patchAvailable)return null;
   return {verified:true,baseSha:expectedHeadSha,
    headSha:attempt===1?next:attempt===2?next2:'d'.repeat(40),patchDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
  }};
 const verifier={async start(){counts.startVerify++;},
  async observe({attempt,headSha}){
   counts.observeVerify++;
   if(pending){pending=false;return {state:'pending',headSha};}
   return {state:'completed',headSha,runId:300+attempt,verified:true,
    conclusion:outcomes[attempt-1]??'failure',errorTrace:'FAIL test assertion on src/example.mjs'};
  }};
 const publisher={async start(){counts.startPublish++;publicationAvailable=true;
  if(unknownPublish)throw Error('lost PR response');},
  async observe({plan:p,headSha}){
   counts.observePublish++;
   return publicationAvailable?{verified:true,branch:p.branch,headSha,prNumber:451}:null;
  }};
 return {records,counts,ledger,generator,patcher,verifier,publisher,
  authorize:async()=>{counts.authorize++;return true;}};
}
function context(f,p=plan(),more={}){return {plan:p,ledger:f.ledger,
 repairer:f.generator,patcher:f.patcher,verifier:f.verifier,
 publisher:f.publisher,authorize:f.authorize,now,...more};}

test('rejects arbitrary paths, commands, paid usage, unbounded retries and protected main',()=>{
 assert.throws(()=>plan({allowedPaths:['.github/workflows/verify.yml']}),/repair-plan/);
 assert.throws(()=>plan({allowedPaths:['../../.env']}),/repair-plan/);
 assert.throws(()=>plan({maxAttempts:4}),/repair-plan/);
 assert.throws(()=>plan({maxPaidCents:1}),/repair-plan/);
 assert.throws(()=>plan({branch:'main'}),/repair-plan/);
 assert.throws(()=>plan({expiresAt:'2026-11-09T19:00:00Z'}),/repair-plan/);
});
test('single attempt verifies exact SHA then publishes only after GitHub readback',async()=>{
 const f=fixture();
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'completed');
 assert.equal(out.attempt,1);assert.equal(out.headSha,next);assert.equal(out.prNumber,451);
 assert.equal(f.counts.apply,1);assert.equal(f.counts.startVerify,1);
 assert.equal(f.counts.startPublish,1);
 assert.equal(f.records.get('repair-case-0001').phase,'complete');
});
test('failed test feedback is persisted and supplied to next bounded repair proposal',async()=>{
 const f=fixture({outcomes:['failure','success']});
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'completed');assert.equal(out.attempt,2);
 assert.equal(out.headSha,next2);assert.equal(f.counts.propose,2);
 assert.equal(f.counts.apply,2);
});
test('exhausts three attempts without publishing failing code',async()=>{
 const f=fixture({outcomes:['failure','failure','failure']});
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'exhausted');assert.equal(out.attempt,3);
 assert.equal(f.counts.startPublish,0);assert.equal(f.counts.apply,3);
});
test('test readback pending survives restarts without redispatching verification',async()=>{
 const f=fixture({pending:true});
 const first=await runAutonomousRepair(context(f));
 assert.equal(first.status,'verifying');
 assert.equal(f.counts.startVerify,1);
 const second=await runAutonomousRepair(context(f));
 assert.equal(second.status,'completed');
 assert.equal(f.counts.startVerify,1);
});
test('uncertain GitHub patch write is reconciled only by fresh readback',async()=>{
 const f=fixture({unknownPatch:true});
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'completed');assert.equal(f.counts.apply,1);
 const again=await runAutonomousRepair(context(f));
 assert.equal(again.status,'completed');assert.equal(f.counts.apply,1);
});
test('missing patch readback holds dispatch intent; restart never repeats the write',async()=>{
 const f=fixture({unknownPatch:true});
 f.patcher.observe=async()=>null;
 const first=await runAutonomousRepair(context(f));
 assert.equal(first.status,'reconcile-required');assert.equal(f.counts.apply,1);
 const second=await runAutonomousRepair(context(f));
 assert.equal(second.status,'reconcile-required');assert.equal(f.counts.apply,1);
 assert.equal(f.counts.startVerify,0);
});
test('uncertain PR creation reobserves without another create request',async()=>{
 const f=fixture({unknownPublish:true});
 const result=await runAutonomousRepair(context(f));
 assert.equal(result.status,'completed');assert.equal(f.counts.startPublish,1);
 const again=await runAutonomousRepair(context(f));
 assert.equal(again.status,'completed');assert.equal(f.counts.startPublish,1);
});
test('unauthorized worker never writes or moves forward',async()=>{
 const f=fixture();f.authorize=async()=>false;
 const result=await runAutonomousRepair(context(f));
 assert.equal(result.status,'held');assert.equal(f.counts.apply,0);
 assert.equal(f.records.get('repair-case-0001').phase,'ready');
});
test('invalid model proposal is refused before reservation or GitHub mutation',async()=>{
 const f=fixture();f.generator.propose=async()=>({objective:'bad',
  baseSha:sha,changes:[{path:'src/other.mjs',before:'old',after:'new'}]});
 const result=await runAutonomousRepair(context(f));
 assert.equal(result.status,'held');assert.equal(f.counts.apply,0);
 assert.equal(f.records.get('repair-case-0001').phase,'ready');
});
test('wrong base SHA or readback digest cannot promote a patch',async()=>{
 const f=fixture();f.patcher.observe=async()=>({verified:true,baseSha:sha,
  headSha:next,patchDigest:'f'.repeat(64)});
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'reconcile-required');
 assert.equal(f.counts.startVerify,0);
});
test('no publisher means verified source but not completed or merged',async()=>{
 const f=fixture();
 const out=await runAutonomousRepair(context(f,plan(),{publisher:undefined}));
 assert.equal(out.status,'verified-awaiting-publication');
 assert.equal(f.counts.startPublish,0);
});
test('untrusted noisy test output is redacted and capped before repair feedback',async()=>{
 const f=fixture({outcomes:['failure','success']});let seen='';
 f.verifier.observe=async({attempt,headSha})=>({state:'completed',verified:true,
  headSha,runId:400+attempt,conclusion:attempt===1?'failure':'success',
  errorTrace:'FAIL password=verySecretValue ghp_'+'x'.repeat(40)+' '.repeat(5000)});
 f.generator.propose=async input=>{if(input.attempt===2)seen=input.previousFailure;
  return {objective:'Fix source',baseSha:input.headSha,
    changes:[{path:'src/example.mjs',before:'old',after:'new-'+input.attempt}]};};
 const out=await runAutonomousRepair(context(f));
 assert.equal(out.status,'completed');assert.match(seen,/FAIL/);
 assert.ok(seen.length<=1500);assert.doesNotMatch(seen,/verySecretValue/);
 assert.doesNotMatch(seen,/ghp_/);
});
