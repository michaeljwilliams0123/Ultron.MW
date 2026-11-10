import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createAutonomousRepairPlan,runAutonomousRepair}
 from '../src/autonomous-repair-loop.mjs';
import {createPostgresAutonomousRepairLedger}
 from '../src/autonomous-repair-postgres-ledger.mjs';

const sha='a'.repeat(40),second='b'.repeat(40),now=()=>Date.parse('2026-11-09T20:00:00Z');
function plan(id='repair-restart-case-001'){
 return createAutonomousRepairPlan({
  id,owner:'michaeljwilliams0123',repository:'michaeljwilliams0123/Ultron.MW',
  branch:'ultron/repair-restart-case-001',baseSha:sha,
  objective:'Repair existing source by independently observing each external effect',
  allowedPaths:['src/demo.mjs'],maxAttempts:3,maxPaidCents:0,
  paidFallback:false,expiresAt:'2026-11-10T19:00:00Z'
 },now());
}
async function postgres(){
 const db=new PGlite();
 await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8'));
 return {db,ledger:createPostgresAutonomousRepairLedger({db})};
}
function harness(ledger,p,{patchResponseLost=false,patchReadbackMissing=false,
 ciPending=false,ciMismatch=false,ownerRevokedForPublication=false}={}){
 const calls={patch:0,verify:0,publish:0};
 let patchCommitted=false,prCommitted=false,
  missing=patchReadbackMissing,pending=ciPending,mismatch=ciMismatch,revoked=ownerRevokedForPublication;
 const repairer={propose:async({headSha})=>({
  objective:'Fix source',baseSha:headSha,
  changes:[{path:'src/demo.mjs',before:'old',after:'new'}]
 })};
 const patcher={apply:async()=>{calls.patch++;patchCommitted=true;
  if(patchResponseLost)throw Error('simulated lost HTTP acknowledgment');},
  observe:async({manifest,expectedHeadSha})=>{
   if(missing){missing=false;return null;}
   return patchCommitted?{verified:true,baseSha:expectedHeadSha,headSha:second,
    patchDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}:null;
  }};
 const verifier={start:async()=>{calls.verify++;},
  observe:async({headSha})=>{
   if(pending){pending=false;return {state:'pending',headSha};}
   if(mismatch){mismatch=false;return {
    state:'completed',verified:true,runId:77,
    headSha:'e'.repeat(40),conclusion:'success'};
   }
   return {state:'completed',verified:true,runId:77,headSha,conclusion:'success'};
  }};
 const publisher={start:async()=>{calls.publish++;prCommitted=true;},
  observe:async({plan,headSha})=>prCommitted?
   {verified:true,branch:plan.branch,headSha,prNumber:52}:null};
 const args={plan:p,ledger,repairer,patcher,verifier,publisher,
  authorize:async({operation})=>!(revoked&&operation==='repair.pr.create'),now};
 return {args,calls,restore:()=>{revoked=false;}};
}
test('real PostgreSQL recovers a lost write response without a second patch',async()=>{
 const {db,ledger}=await postgres();
 try{
  const p=plan(),f=harness(ledger,p,{patchResponseLost:true,patchReadbackMissing:true});
  const first=await runAutonomousRepair(f.args);
  assert.equal(first.status,'reconcile-required');
  assert.equal((await ledger.read(p.id)).phase,'patch-dispatched');
  const restored=createPostgresAutonomousRepairLedger({db});
  const done=await runAutonomousRepair({...f.args,ledger:restored});
  assert.equal(done.status,'completed');
  assert.equal(f.calls.patch,1);
  assert.equal(f.calls.publish,1);
  const events=(await db.query('SELECT to_phase FROM brain_autonomous_repair_events ORDER BY version')).rows;
  assert.deepEqual(events.map(e=>e.to_phase),[
   'patch-dispatched','applied','verifying','verified',
   'publication-dispatched','complete']);
 }finally{await db.close();}
});
test('pending and mismatched exact-head CI remain unverified without redispatch',async()=>{
 const {db,ledger}=await postgres();
 try{
  const p=plan('repair-restart-case-002');
  const f=harness(ledger,p,{ciPending:true,ciMismatch:true});
  assert.equal((await runAutonomousRepair(f.args)).status,'verifying');
  assert.equal(f.calls.verify,1);
  assert.equal((await runAutonomousRepair(f.args)).status,'reconcile-required');
  assert.equal((await ledger.read(p.id)).phase,'verifying');
  assert.equal(f.calls.verify,1);
  assert.equal((await runAutonomousRepair(f.args)).status,'completed');
  assert.equal(f.calls.verify,1);
  assert.equal(f.calls.patch,1);
 }finally{await db.close();}
});
test('owner revocation before PR write leaves verified source held and resumes after authorization',async()=>{
 const {db,ledger}=await postgres();
 try{
  const p=plan('repair-restart-case-003');
  const f=harness(ledger,p,{ownerRevokedForPublication:true});
  const first=await runAutonomousRepair(f.args);
  assert.equal(first.status,'held');
  assert.equal((await ledger.read(p.id)).phase,'verified');
  assert.equal(f.calls.publish,0);
  f.restore();
  const next=await runAutonomousRepair(f.args);
  assert.equal(next.status,'completed');
  assert.equal(f.calls.patch,1);assert.equal(f.calls.verify,1);
  assert.equal(f.calls.publish,1);
 }finally{await db.close();}
});
test('concurrent repair runners cannot both win a durable patch-dispatch CAS',async()=>{
 const {db,ledger}=await postgres();
 try{
  const p=plan('repair-restart-case-004'),f=harness(ledger,p);
  let proposals=0;
  const waiting=[];
  f.args.repairer={propose:async({headSha})=>{
   proposals++;
   return new Promise(resolve=>waiting.push(()=>resolve({
    objective:'Fix source',baseSha:headSha,
    changes:[{path:'src/demo.mjs',before:'old',after:'new'}]
   })));
  }};
  const one=runAutonomousRepair(f.args);
  const two=runAutonomousRepair(f.args);
  for(let t=0;t<20&&proposals<2;t++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(proposals,2);
  waiting.forEach(wake=>wake());
  const results=await Promise.allSettled([one,two]);
  assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.status==='completed').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.calls.patch,1);
  assert.equal((await ledger.read(p.id)).phase,'complete');
 }finally{await db.close();}
});
