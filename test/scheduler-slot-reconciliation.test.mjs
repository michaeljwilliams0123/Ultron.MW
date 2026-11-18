import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTerminalSlotEvidence,reconcileRecentNaturalSlots} from '../cloud/hatchable/lib/scheduler-slot-reconciliation.js';

const canonical={slot_key:'2026-11-18T03:00Z',repo_status:'done',council_status:'done',
 repo_source:'github-api',repo_repository:'michaeljwilliams0123/Ultron.MW',
 repo_admissions:1,council_admissions:1,authentic_repo_admissions:1,authentic_council_admissions:1,
 observed_repo_receipts:1,observed_council_receipts:1,
 council_assessments:1,free_council_assessments:1};

test('BUG-184 completed genuine hourly work must transition slot pending to done',async()=>{
 let status='pending',completed=0;const db={async query(sql,params){
  if(sql.includes('SELECT s.slot_key'))return {rows:[canonical]};
  if(sql.includes('UPDATE brain_scheduler_slots')){if(status!=='pending')return {rows:[]};status=params[1];completed++;return {rows:[{slot_key:params[0]}]};}
  throw new Error('unexpected SQL');
 }};
 const outcomes=[{status:'done',task_id:4738,objective:'repo.inspect'},
                 {status:'done',task_id:4739,objective:'council.review'}];
 const first=await reconcileRecentNaturalSlots({db,outcomes});
 assert.equal(status,'done');assert.equal(completed,1);assert.equal(first.completed,1);
 const next=await reconcileRecentNaturalSlots({db,outcomes});
 assert.equal(completed,1);assert.equal(next.completed,0);
});

test('BUG-184 never accepts duplicate, manual, recovered, or unobserved admissions',()=>{
 assert.equal(classifyTerminalSlotEvidence(canonical),'done');
 for (const [key,value] of Object.entries({repo_admissions:2,authentic_repo_admissions:0,
  council_admissions:2,authentic_council_admissions:0,observed_repo_receipts:0,
  observed_council_receipts:2,council_assessments:2,free_council_assessments:0,
  repo_source:'simulated',repo_repository:'other/repo',repo_status:'leased',council_status:'queued'})){
  assert.equal(classifyTerminalSlotEvidence({...canonical,[key]:value}),null,key);
 }
});

test('BUG-184 blocked natural task records failed but never successful slot',()=>{
 assert.equal(classifyTerminalSlotEvidence({...canonical,council_status:'blocked'}),'failed');
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_admissions:0,council_status:'blocked'}),null);
});

test('BUG-184 unrelated work or unresolved completion never mutates slot ledger',async()=>{
 let queried=0;
 const db={async query(){queried++;return {rows:[canonical]}}};
 const out=await reconcileRecentNaturalSlots({db,outcomes:[{status:'done',task_id:5,objective:'site.render'},
  {status:'completion-uncertain',task_id:6,objective:'repo.inspect'}]});
 assert.equal(queried,0);assert.equal(out.completed,0);
});
