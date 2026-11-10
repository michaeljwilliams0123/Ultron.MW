import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createAutonomousRepairPlan,runAutonomousRepair}
 from '../src/autonomous-repair-loop.mjs';
import {createPostgresAutonomousRepairLedger}
 from '../src/autonomous-repair-postgres-ledger.mjs';

const SHA='a'.repeat(40),PATCH_SHA='b'.repeat(40);
const now=()=>Date.parse('2026-11-10T19:00:00Z');
let sequence=0;
function plan(){
 const n=String(++sequence).padStart(3,'0');
 return createAutonomousRepairPlan({
  id:'repair-production-fault-'+n,
  owner:'michaeljwilliams0123',
  repository:'michaeljwilliams0123/Ultron.MW',
  branch:'ultron/repair-production-fault-'+n,
  baseSha:SHA,
  objective:'Reconcile uncertain GitHub effects against a durable PostgreSQL record',
  allowedPaths:['src/demo.mjs'],maxAttempts:3,maxPaidCents:0,
  paidFallback:false,expiresAt:'2026-11-11T00:00:00Z'
 },now());
}
async function setup(){
 const db=new PGlite();
 await db.exec(readFileSync(
  new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',
   import.meta.url),'utf8'));
 return {db,ledger:createPostgresAutonomousRepairLedger({db})};
}
function adapters(ledger,p){
 const calls={patch:0,ci:0,post:0,observePr:0};
 const state={patchCommitted:false,prCommitted:false,prNumber:360,
  losePrResponse:false,hidePrReadback:false};
 const repairer={propose:async({headSha})=>({
  objective:'Fix source',baseSha:headSha,
  changes:[{path:'src/demo.mjs',before:'old',after:'new'}]
 })};
 const patcher={
  apply:async()=>{calls.patch++;state.patchCommitted=true;},
  observe:async({manifest,expectedHeadSha})=>
   state.patchCommitted?{verified:true,baseSha:expectedHeadSha,
    headSha:PATCH_SHA,
    patchDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}:null
 };
 const verifier={
  start:async()=>{calls.ci++;},
  observe:async({headSha})=>({state:'completed',verified:true,
   runId:12123,headSha,conclusion:'success'})
 };
 const publisher={
  start:async()=>{calls.post++;state.prCommitted=true;
   if(state.losePrResponse)throw Error('HTTP response lost after external PR creation');},
  observe:async({plan,headSha})=>{
   calls.observePr++;
   if(state.hidePrReadback||!state.prCommitted)return null;
   return {verified:true,branch:plan.branch,headSha,
    prNumber:state.prNumber};
  }
 };
 return {args:{plan:p,ledger,repairer,patcher,verifier,publisher,
   authorize:async()=>true,now},calls,state};
}
test('lost GitHub PR POST acknowledgement never creates a duplicate after a restart',async()=>{
 const {db,ledger}=await setup();
 try{
  const p=plan(),f=adapters(ledger,p);
  f.state.losePrResponse=true;
  f.state.hidePrReadback=true;
  assert.equal((await runAutonomousRepair(f.args)).status,'reconcile-required');
  assert.equal((await ledger.read(p.id)).phase,'publication-dispatched');
  assert.equal(f.calls.post,1);
  const restored=createPostgresAutonomousRepairLedger({db});
  f.state.hidePrReadback=false;
  assert.equal((await runAutonomousRepair({...f.args,ledger:restored})).status,'completed');
  assert.equal(f.calls.post,1,'never dispatch the uncertain POST again');
  assert.equal(f.calls.patch,1);
  assert.equal((await restored.read(p.id)).prNumber,360);
 }finally{await db.close();}
});
test('lost PostgreSQL completion acknowledgement reconciles without repeating external writes',async()=>{
 const {db,ledger}=await setup();
 try{
  const p=plan(),f=adapters(ledger,p);
  let dropOnce=true;
  const faultLedger={...ledger,transition:async request=>{
   const result=await ledger.transition(request);
   if(request.to==='complete'&&dropOnce){
    dropOnce=false;throw Error('database response lost after committed transaction');
   }
   return result;
  }};
  await assert.rejects(()=>runAutonomousRepair({...f.args,ledger:faultLedger}),
   /database response lost/);
  const durable=createPostgresAutonomousRepairLedger({db});
  assert.equal((await durable.read(p.id)).phase,'complete');
  assert.equal((await runAutonomousRepair({...f.args,ledger:durable})).status,'completed');
  assert.equal(f.calls.post,1);
  assert.equal(f.calls.patch,1);
 }finally{await db.close();}
});
test('completed checkpoint cannot be accepted if the independently observed PR number drifts',async()=>{
 const {db,ledger}=await setup();
 try{
  const p=plan(),f=adapters(ledger,p);
  assert.equal((await runAutonomousRepair(f.args)).status,'completed');
  const receipt=await ledger.read(p.id);
  assert.equal(receipt.prNumber,360);
  f.state.prNumber=361; // Provider returned another PR after a force-push or alias mix-up.
  const value=await runAutonomousRepair(f.args);
  assert.equal(value.status,'reconcile-required',
   'a different PR number must not confirm an existing completed receipt');
  assert.equal((await ledger.read(p.id)).phase,'complete');
  assert.equal(f.calls.post,1);
 }finally{await db.close();}
});
test('completed checkpoint remains uncertain when external PR disappears and returns',async()=>{
 const {db,ledger}=await setup();
 try{
  const p=plan(),f=adapters(ledger,p);
  assert.equal((await runAutonomousRepair(f.args)).status,'completed');
  f.state.hidePrReadback=true;
  assert.equal((await runAutonomousRepair(f.args)).status,'reconcile-required');
  f.state.hidePrReadback=false;
  assert.equal((await runAutonomousRepair(f.args)).status,'completed');
  assert.equal(f.calls.post,1);
 }finally{await db.close();}
});
