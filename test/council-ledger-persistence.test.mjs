import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticateCouncilAppActor,issueCouncilExecutionReceipt} from '../src/council-app-identities.mjs';
import {createLedgerClient,runLedgeredAction} from '../src/council-ledger-client.mjs';
import {executionKey} from '../src/council-execution-ledger.mjs';
import * as cloud from '../cloud/hatchable/lib/council-ledger.js';

let PGlite=null;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
const skip=PGlite?false:'@electric-sql/pglite not installed';

const repo='michaeljwilliams0123/Ultron.MW';
const sourceSha='a'.repeat(40),caseSha='b'.repeat(64);
const MIGRATION=readFileSync(new URL('../cloud/hatchable/migrations/0028_council_execution_ledger.sql',import.meta.url),'utf8');

async function freshDb(){
 const db=new PGlite();
 await db.exec(MIGRATION);
 return db;
}
// In-process transport that exercises the real Hatchable ledger lib on Postgres.
const transportFor=(db,hooks={})=>async body=>{
 hooks.onCall?.(body);
 if(body.op==='reserve')return{status:200,body:{ok:true,...await cloud.reserveExecution(db,body)}};
 if(body.op==='transition'){
  if(hooks.dropAck&&body.to!=='dispatched')throw Error('network-reset');
  const out=await cloud.transitionExecution(db,body);
  return{status:out.ok?200:409,body:out};
 }
 const record=await cloud.readExecution(db,body.key);
 return{status:record?200:404,body:{ok:Boolean(record),record}};
};
const actor=role=>authenticateCouncilAppActor({role,sourceSha,installationToken:'x'.repeat(20),
 expectedAppId:10,
 githubProbe:async()=>({source:'github-installations-api',app_id:10,id:20,app_slug:'ultron-mw-'+role.toLowerCase(),
  repositories:[repo],permissions:{metadata:'read',contents:'read',issues:'write',pull_requests:'write',checks:'read',actions:'read'}})});
const receiptFor=async(role='Builder',operation='issue.comment')=>issueCouncilExecutionReceipt(await actor(role),{
 operation,caseSha,observedAt:'2026-11-05T18:00:00Z',
 githubResponse:{source:'github-api-response',url:'https://api.github.com/repos/'+repo+'/issues/comments/5',
  id:5,author_login:'ultron-mw-'+role.toLowerCase()+'[bot]',author_type:'Bot',
  app_id:10,app_slug:'ultron-mw-'+role.toLowerCase()}});
const intent=(over={})=>({role:'Builder',operation:'issue.comment',caseDigest:caseSha,sourceSha,ordinal:0,
 authContext:{profile:'owner-equivalent',actor:'github-actions'},expectedEffect:'comment',...over});

test('migration enforces identity, terminal immutability and append-only events',{skip},async()=>{
 const db=await freshDb();
 const {record}=await cloud.reserveExecution(db,intent());
 assert.equal(record.state,'reserved');
 await assert.rejects(()=>db.query("UPDATE brain_council_executions SET operation='x' WHERE execution_key=$1",[record.key]),/identity-immutable/);
 await assert.rejects(()=>db.query('DELETE FROM brain_council_executions'),/immutable/);
 await cloud.transitionExecution(db,{key:record.key,from:'reserved',to:'dispatched'});
 await cloud.transitionExecution(db,{key:record.key,from:'dispatched',to:'failed',detail:{reason:'boom'}});
 await assert.rejects(()=>db.query("UPDATE brain_council_executions SET state='verified' WHERE execution_key=$1",[record.key]),/terminal-immutable/);
 await assert.rejects(()=>db.query('UPDATE brain_council_execution_events SET to_state=$1',['x']),/append-only/);
 const ev=await db.query('SELECT seq,from_state,to_state FROM brain_council_execution_events ORDER BY seq');
 assert.deepEqual(ev.rows.map(r=>r.to_state),['reserved','dispatched','failed']);
});

test('reserve is idempotent; transitions are compare-and-set',{skip},async()=>{
 const db=await freshDb();
 const a=await cloud.reserveExecution(db,intent()),b=await cloud.reserveExecution(db,intent());
 assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(b.record.key,a.record.key);
 assert.equal(a.record.key,executionKey({role:'Builder',operation:'issue.comment',caseSha,sourceSha}));
 const [x,y]=await Promise.all([
  cloud.transitionExecution(db,{key:a.record.key,from:'reserved',to:'dispatched'}),
  cloud.transitionExecution(db,{key:a.record.key,from:'reserved',to:'dispatched'})]);
 assert.deepEqual([x.ok,y.ok].sort(),[false,true]);
 assert.equal((await cloud.transitionExecution(db,{key:a.record.key,from:'reserved',to:'dispatched'})).error,'state-conflict');
 await assert.rejects(()=>cloud.transitionExecution(db,{key:a.record.key,from:'reserved',to:'verified'}),/transition-invalid/);
});

test('verified requires a receipt bound to the exact intent; forged receipts rejected',{skip},async()=>{
 const db=await freshDb();
 const {record}=await cloud.reserveExecution(db,intent());
 await cloud.transitionExecution(db,{key:record.key,from:'reserved',to:'dispatched'});
 const good=await receiptFor();
 const wrongRole=await receiptFor('Skeptic');
 const tampered={...good,operation:'pr.comment'};
 for(const receipt of [wrongRole,tampered,{...good,caseSha:'c'.repeat(64)},undefined]){
  const r=await cloud.transitionExecution(db,{key:record.key,from:'dispatched',to:'verified',detail:{receipt}});
  assert.equal(r.ok,false);assert.equal(r.error,'receipt-mismatch');
 }
 const ok=await cloud.transitionExecution(db,{key:record.key,from:'dispatched',to:'verified',detail:{receipt:good}});
 assert.equal(ok.ok,true);
 assert.equal(ok.record.executor,'ultron-mw-builder[bot]');
 assert.equal(ok.record.receiptDigest,good.digest);
});

test('write -> readback: verified action persists and a duplicate request is not re-executed',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));
 let writes=0;const receipt=await receiptFor();
 const run=()=>runLedgeredAction({ledger,intent:intent(),probe:async()=>null,
  execute:async()=>{writes++;return{op:'issue.comment',status:'done',receipt};}});
 const first=await run();
 assert.equal(first.ledgerState,'verified');assert.equal(first.status,'done');
 const second=await run();
 assert.equal(second.status,'duplicate');assert.equal(second.skipped,true);
 assert.equal(writes,1);
 const stored=await cloud.readExecution(db,first.executionKey);
 assert.equal(stored.state,'verified');assert.equal(stored.receipt.digest,receipt.digest);
 assert.deepEqual(stored.history,['intent','reserved','dispatched','verified']);
});

test('concurrent identical requests execute the external write exactly once',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));
 let writes=0;const receipt=await receiptFor();
 const run=()=>runLedgeredAction({ledger,intent:intent(),probe:async()=>null,sleepMs:1,
  execute:async()=>{writes++;await new Promise(r=>setTimeout(r,20));return{status:'done',receipt};}});
 const results=await Promise.all([run(),run(),run()]);
 assert.equal(writes,1);
 assert.equal(results.filter(r=>r.status==='done').length,1);
});

test('unattributed effects are executed, never verified or independent',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));
 const r=await runLedgeredAction({ledger,intent:intent({operation:'issue.label'}),
  execute:async()=>({status:'done',effect:{url:'https://api.github.com/repos/'+repo+'/issues/1'}})});
 assert.equal(r.ledgerState,'executed');
 const stored=await cloud.readExecution(db,r.executionKey);
 assert.equal(stored.executor,'unattributed');assert.equal(stored.receipt,null);
});

test('interrupted acknowledgment recovers by readback without re-sending the write',{skip},async()=>{
 const db=await freshDb();let writes=0;
 const receipt=await receiptFor();
 const flaky=createLedgerClient(transportFor(db,{dropAck:true}));
 const first=await runLedgeredAction({ledger:flaky,sleepMs:1,intent:intent(),probe:async()=>null,
  execute:async()=>{writes++;return{op:'issue.comment',status:'done',receipt};}});
 assert.equal(first.status,'ack-interrupted');
 assert.equal(first.ledgerState,'dispatched');
 assert.equal((await cloud.readExecution(db,first.executionKey)).state,'dispatched');

 const healthy=createLedgerClient(transportFor(db));
 const retry=await runLedgeredAction({ledger:healthy,sleepMs:1,intent:intent(),
  probe:async()=>({receipt}),execute:async()=>{writes++;return{status:'done'};}});
 assert.equal(retry.status,'recovered');assert.equal(writes,1);
 assert.equal((await cloud.readExecution(db,first.executionKey)).state,'verified');
});

test('unknown outcome becomes reconcile-required and is never blindly replayed',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));let writes=0;
 const crash=await runLedgeredAction({ledger,sleepMs:1,intent:intent(),probe:async()=>null,
  execute:async()=>{writes++;throw Error('socket hang up');}});
 assert.equal(crash.status,'error');assert.equal(crash.ledgerState,'reconcile-required');
 for(let i=0;i<2;i++){
  const again=await runLedgeredAction({ledger,sleepMs:1,intent:intent(),probe:async()=>null,
   execute:async()=>{writes++;return{status:'done'};}});
  assert.equal(again.status,'reconcile-required');assert.equal(again.skipped,true);
 }
 assert.equal(writes,1);
 const found=await runLedgeredAction({ledger,sleepMs:1,intent:intent(),
  probe:async()=>({executor:'unattributed',url:'https://api.github.com/repos/'+repo+'/issues/comments/9'}),
  execute:async()=>{writes++;return{status:'done'};}});
 assert.equal(found.status,'recovered');assert.equal(writes,1);
 assert.equal((await cloud.readExecution(db,crash.executionKey)).state,'executed');
});

test('crash after write but before throw is recovered from provider readback',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));const receipt=await receiptFor();
 const r=await runLedgeredAction({ledger,sleepMs:1,intent:intent(),probe:async()=>({receipt}),
  execute:async()=>{throw Error('timeout after server accepted');}});
 assert.equal(r.status,'recovered');
 assert.equal((await cloud.readExecution(db,r.executionKey)).state,'verified');
});

test('denied and unsupported actions are recorded failed; plan-only ops stay planned',{skip},async()=>{
 const db=await freshDb();const ledger=createLedgerClient(transportFor(db));
 const denied=await runLedgeredAction({ledger,intent:intent({operation:'pr.merge'}),
  execute:async()=>({op:'pr.merge',status:'denied',reason:'ability-not-admitted'})});
 assert.equal(denied.status,'denied');assert.equal(denied.ledgerState,'failed');
 assert.equal((await cloud.readExecution(db,denied.executionKey)).reason,'ability-not-admitted');
 let ran=false;
 const plan=await runLedgeredAction({ledger,intent:intent({operation:'mahoraga.repo.inspect'}),
  execute:async()=>{ran=true;return{status:'done'};}});
 assert.equal(plan.status,'planned');assert.equal(ran,false);
});

test('fails closed: no ledger, no external write',async()=>{
 let writes=0;
 const ledger=createLedgerClient(async()=>{throw Error('ECONNREFUSED');});
 const r=await runLedgeredAction({ledger,intent:intent(),execute:async()=>{writes++;return{status:'done'};}});
 assert.equal(r.status,'blocked');assert.equal(r.reason,'ledger-unavailable');assert.equal(writes,0);
});
