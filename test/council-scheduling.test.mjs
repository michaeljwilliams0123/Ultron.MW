import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../cloud/hatchable/',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');

test('C04 hourly tick durably admits one repository observation and one $0 advisory review',()=>{
 const tick=source('api/brain/tick.js');
 assert.match(tick,/INSERT INTO brain_tasks\(task_key,objective\)/);
 assert.match(tick,/VALUES\(\$1,'repo\.inspect'\),\(\$2,'council\.review'\)/);
 assert.match(tick,/ON CONFLICT\(task_key\) DO NOTHING/);
 assert.match(tick,/council-hourly-/);
 assert.match(tick,/scheduled-hourly/);
 assert.match(tick,/mode:'dispatch-only'/);
 assert.doesNotMatch(tick,/executeObjective\(/);
});

test('C04 a new substantive Council case creates one review task in the same fenced completion',()=>{
 const runner=source('lib/brain-runner.js');
 const completion=runner.slice(runner.indexOf('const done=await db.query'));
 assert.match(completion,/INSERT INTO brain_council_cases/);
 assert.match(completion,/ON CONFLICT \(case_digest\) DO NOTHING RETURNING id,case_digest/);
 assert.match(completion,/INSERT INTO brain_tasks\(task_key,objective\)/);
 assert.match(completion,/SELECT 'council-case:'\s*\|\|\s*case_digest,'council\.review' FROM council_cases/);
 assert.match(completion,/ON CONFLICT\(task_key\) DO NOTHING RETURNING id/);
 assert.match(completion,/INSERT INTO brain_events\(task_id,event_type,details\)/);
 assert.match(completion,/'council-case-admitted'/);
 assert.match(completion,/SELECT id FROM moved/);
});

test('C04 hourly admission is idempotent across repeated scheduler calls',async()=>{
 const text=source('api/brain/tick.js');
 const ctx={calls:[],ticks:0,notifications:0};
 globalThis.__c04TickContext=ctx;
 const transformed=text
  .replace("import { db,scheduler,events } from 'hatchable';",
    'const {db,scheduler,events}=globalThis.__c04TickPlatform;')
  .replace("import {notifyOwner} from 'lib/owner-live-events.js';",
    'const notifyOwner=async()=>{globalThis.__c04TickContext.notifications++;};');
 assert.notEqual(transformed,text);
 globalThis.__c04TickPlatform={
  db:{async query(sql,params=[]){
   ctx.calls.push({sql,params});
   if(sql.includes("scheduled-hourly")){
    ctx.ticks++;
    return {rows:ctx.ticks===1?[{id:301,objective:'repo.inspect'},{id:302,objective:'council.review'},{id:303,objective:'research.intake'}]:[]};
   }
   return {rows:[{n:0}]};
  }},
  scheduler:{async now(){throw Error('no backlog should be scheduled in this unit test');}},
  events:{}
 };
 try{
  const url='data:text/javascript;base64,'+Buffer.from(transformed).toString('base64');
  const endpoint=await import(url);
  const first=await endpoint.default({}, {json:value=>value});
  const second=await endpoint.default({}, {json:value=>value});
  assert.equal(first.scheduled_count,3);
  assert.equal(second.scheduled_count,0);
  assert.equal(ctx.notifications,1);
  const calls=ctx.calls.filter(x=>x.sql.includes("scheduled-hourly"));
  assert.equal(calls.length,2);
  assert.equal(calls[0].params.length,3);
  assert.match(calls[0].params[0],/^hourly-\d{10}$/);
  assert.match(calls[0].params[1],/^council-hourly-\d{10}$/);
  assert.match(calls[0].params[2],/^research-slot-\d{8}-[0-3]$/);
  assert.equal(calls[0].params[0].slice('hourly-'.length),
   calls[0].params[1].slice('council-hourly-'.length));
 }finally{
  delete globalThis.__c04TickPlatform;
  delete globalThis.__c04TickContext;
 }
});
