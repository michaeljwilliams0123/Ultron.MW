import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {recoverMissedHours} from '../cloud/hatchable/lib/scheduler-recovery.js';

const AT='2026-11-09T13:15:00.000Z';
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE brain_tasks(
  id BIGSERIAL PRIMARY KEY,task_key TEXT NOT NULL UNIQUE,objective TEXT NOT NULL);
 CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,task_id BIGINT REFERENCES brain_tasks(id),
  event_type TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ DEFAULT now());`);
 return db;
}
test('C02: lost hourly slots backfill read-only tasks and independent recovery receipts once',async()=>{
 const db=await setup();
 try{
  await db.exec(`INSERT INTO brain_tasks(task_key,objective) VALUES
   ('hourly-2026110912','repo.inspect'),
   ('council-hourly-2026110912','council.review');`);
  const first=await recoverMissedHours({db,now:new Date(AT),lookbackHours:6});
  assert.equal(first.recoveredCount,10);
  assert.equal(first.windowHours,6);
  assert.equal(first.oldestHour,'2026110907');
  assert.equal(first.newestHour,'2026110912');
  const tasks=(await db.query("SELECT task_key,objective FROM brain_tasks ORDER BY task_key")).rows;
  assert.equal(tasks.length,12);
  assert.ok(tasks.some(x=>x.task_key==='hourly-2026110907'));
  assert.ok(tasks.some(x=>x.task_key==='council-hourly-2026110911'));
  const ev=(await db.query("SELECT event_type,details FROM brain_events ORDER BY id")).rows;
  assert.equal(ev.length,10);
  assert.ok(ev.every(x=>x.event_type==='missed-hour-recovered'));
  assert.ok(ev.every(x=>x.details?.paidCents===0));
  assert.ok(ev.every(x=>/^20261109(?:0[7-9]|1[0-2])$/.test(x.details?.scheduledHour||'')));
  assert.equal((await recoverMissedHours({db,now:new Date(AT),lookbackHours:6})).recoveredCount,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM brain_events')).rows[0].n,10);
 }finally{await db.close();}
});
test('C02: recovery rejects over-broad windows and cannot forge scheduler fire evidence',async()=>{
 const db=await setup();
 try{
  for(const hours of [0,-1,7,100,NaN,1.5]){
   await assert.rejects(recoverMissedHours({db,now:new Date(AT),lookbackHours:hours}),/scheduler-recovery-input-invalid/);
  }
  await assert.rejects(recoverMissedHours({db,now:new Date('invalid'),lookbackHours:6}),/scheduler-recovery-input-invalid/);
  assert.equal((await db.query('SELECT count(*)::int n FROM brain_events')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM brain_tasks')).rows[0].n,0);
 }finally{await db.close();}
});
test('C02: existing hourly tick invokes bounded read-only recovery, without extra cron or provider calls',()=>{
 const text=readFileSync(new URL('../cloud/hatchable/api/brain/tick.js',import.meta.url),'utf8');
 assert.match(text,/recoverMissedHours\(/);
 assert.match(text,/lookbackHours:6/);
 assert.match(text,/recovered_count/);
 assert.doesNotMatch(text,/api\.github\.com|gitlab\.com|browser\.action/);
});
