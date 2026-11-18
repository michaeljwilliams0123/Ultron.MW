import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {classifyTerminalSlotEvidence,reconcileRecentNaturalSlots} from '../cloud/hatchable/lib/scheduler-slot-reconciliation.js';

const canonical={slot_key:'2026-11-18T03:00Z',classification:'scheduled',repo_status:'done',council_status:'done',
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
 assert.equal(classifyTerminalSlotEvidence({...canonical,classification:'recovery'}),null);
 assert.equal(classifyTerminalSlotEvidence({...canonical,classification:undefined}),null);
 for (const [key,value] of Object.entries({repo_admissions:2,authentic_repo_admissions:0,
  council_admissions:2,authentic_council_admissions:0,observed_repo_receipts:0,
  observed_council_receipts:2,council_assessments:2,free_council_assessments:0,
  repo_source:'simulated',repo_repository:'other/repo',repo_status:'leased',council_status:'queued'})){
  assert.equal(classifyTerminalSlotEvidence({...canonical,[key]:value}),null,key);
 }
});

test('BUG-184 blocked status without terminal failure evidence remains pending',()=>{
 assert.equal(classifyTerminalSlotEvidence({...canonical,council_status:'blocked',
  terminal_council_failure_receipts:0}),null);
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_status:'blocked',
  terminal_repo_failure_receipts:0}),null);
});

test('BUG-184 genuine attempt limit or final blocked failure records failed once',()=>{
 assert.equal(classifyTerminalSlotEvidence({...canonical,council_status:'blocked',
  terminal_council_failure_receipts:1}),'failed');
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_status:'blocked',
  terminal_repo_failure_receipts:1}),'failed');
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_admissions:0,
  council_status:'blocked',terminal_council_failure_receipts:1}),null);
});

test('BUG-184 queued partial completion and duplicated terminal receipts cannot be misclassified',()=>{
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_status:'done',
  council_status:'queued',terminal_council_failure_receipts:0}),null);
 assert.equal(classifyTerminalSlotEvidence({...canonical,council_status:'blocked',
  terminal_council_failure_receipts:2}),null);
 assert.equal(classifyTerminalSlotEvidence({...canonical,repo_status:'blocked',
  terminal_repo_failure_receipts:2}),null);
 assert.equal(classifyTerminalSlotEvidence({...canonical,council_status:'blocked',
  council_admissions:2,terminal_council_failure_receipts:1}),null);
});

test('BUG-184 readback query uses event-backed terminal status rather than task state alone',async()=>{
 let sqlText='';
 const db={async query(sql){
  if(sql.includes('SELECT s.slot_key')){sqlText=sql;return {rows:[]};}
  throw Error('unexpected write');
 }};
 const result=await reconcileRecentNaturalSlots({db,
  outcomes:[{status:'failed',task_id:4739,objective:'council.review'}]});
 assert.equal(result.completed,0);
 assert.equal(result.failed,0);
 assert.match(sqlText,/event_type='attempt-limit'/);
 assert.match(sqlText,/next_status.*blocked/);
});


test('BUG-184 unrelated work or unresolved completion never mutates slot ledger',async()=>{
 let queried=0;
 const db={async query(){queried++;return {rows:[canonical]}}};
 const out=await reconcileRecentNaturalSlots({db,outcomes:[{status:'done',task_id:5,objective:'site.render'},
  {status:'completion-uncertain',task_id:6,objective:'repo.inspect'}]});
 assert.equal(queried,0);assert.equal(out.completed,0);
});

async function createSlotDb(t,{blocked=false,terminalReceipt=true}={}){
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec(`CREATE TABLE brain_scheduler_slots(
  slot_key text PRIMARY KEY,classification text,completion_status text,
  actual_pickup_at timestamptz,updated_at timestamptz DEFAULT now(),evidence jsonb);
 CREATE TABLE brain_tasks(id bigint PRIMARY KEY,task_key text UNIQUE,status text,last_result jsonb);
 CREATE TABLE brain_events(task_id bigint,event_type text,details jsonb);`);
 const date=new Date();
 const slot=date.toISOString().slice(0,13)+':00Z';
 const hour=slot.slice(0,13).replace(/[-T]/g,'');
 const sourceSha='a'.repeat(40);
 await db.query('INSERT INTO brain_scheduler_slots(slot_key,classification,completion_status,actual_pickup_at,evidence) VALUES($1,$2,$3,$4,$5::jsonb)',
  [slot,'scheduled','pending',date.toISOString(),JSON.stringify({sloBreach:false,primaryOnTime:false})]);
 await db.query('INSERT INTO brain_tasks(id,task_key,status,last_result) VALUES($1,$2,$3,$4::jsonb),($5,$6,$7,$8::jsonb)',
  [9301,'hourly-'+hour,'done',JSON.stringify({source:'github-api',repository:'michaeljwilliams0123/Ultron.MW',sha:sourceSha}),
   9302,'council-hourly-'+hour,blocked?'blocked':'done',JSON.stringify({source:'local-evidence-only'})]);
 for(const id of [9301,9302]){
  await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
   [id,'scheduled-hourly',JSON.stringify({trigger:'cron',admittedAt:date.toISOString()})]);
 }
 await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
  [9301,'observed',JSON.stringify({source:'github-api'})]);
 if(blocked&&terminalReceipt)
  await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
   [9302,'failed',JSON.stringify({next_status:'blocked'})]);
 if(!blocked){
  await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
   [9302,'observed',JSON.stringify({source:'local-evidence-only'})]);
  await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
   [9302,'council-assessment',JSON.stringify({creditCost:0,paidFallback:false,sourceSha})]);
 }
 return {db,slot};
}

test('BUG-184 PGlite genuine natural task receipts close one slot without replay',async t=>{
 const {db,slot}=await createSlotDb(t);
 const outcomes=[{status:'done',task_id:9301,objective:'repo.inspect'},
  {status:'done',task_id:9302,objective:'council.review'}];
 const first=await reconcileRecentNaturalSlots({db,outcomes});
 assert.equal(first.completed,1);
 assert.equal(first.failed,0);
 const row=(await db.query('SELECT completion_status,evidence FROM brain_scheduler_slots WHERE slot_key=$1',[slot])).rows[0];
 assert.equal(row.completion_status,'done');
 assert.equal(row.evidence.sloBreach,false);
 const replay=await reconcileRecentNaturalSlots({db,outcomes});
 assert.equal(replay.completed,0);
});

test('BUG-184 PGlite blocked task needs a terminal event before failing a natural slot',async t=>{
 const {db,slot}=await createSlotDb(t,{blocked:true,terminalReceipt:false});
 const outcomes=[{status:'failed',task_id:9302,objective:'council.review'}];
 assert.equal((await reconcileRecentNaturalSlots({db,outcomes})).failed,0);
 assert.equal((await db.query('SELECT completion_status FROM brain_scheduler_slots WHERE slot_key=$1',[slot])).rows[0].completion_status,'pending');
 await db.query('INSERT INTO brain_events(task_id,event_type,details) VALUES($1,$2,$3::jsonb)',
  [9302,'attempt-limit',JSON.stringify({fencingGeneration:2})]);
 assert.equal((await reconcileRecentNaturalSlots({db,outcomes})).failed,1);
 assert.equal((await db.query('SELECT completion_status FROM brain_scheduler_slots WHERE slot_key=$1',[slot])).rows[0].completion_status,'failed');
});
