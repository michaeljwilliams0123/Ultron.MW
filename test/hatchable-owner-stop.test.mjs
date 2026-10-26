import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readExecutionControl,setExecutionControl} from '../cloud/hatchable/lib/runtime-control.js';

test('owner pause/resume admits only exact-version changes with a single atomic receipt',async()=>{
 const calls=[],db={query:async(sql,params)=>{
  calls.push({sql,params});
  return {rows:[{paused:true,version:3,receipt_id:81}]};
 }};
 const r=await setExecutionControl({db,action:'pause',expectedVersion:2,
  reason:'owner-emergency-stop'});
 assert.deepEqual(r,{ok:true,paused:true,version:3,receiptId:81});
 assert.match(calls[0].sql,/UPDATE brain_runtime_control/);
 assert.match(calls[0].sql,/WHERE id=1 AND version=\$3/);
 assert.match(calls[0].sql,/INSERT INTO brain_events/);
 assert.deepEqual(calls[0].params,[true,'owner-emergency-stop',2,'owner-execution-paused']);
});
test('stale owner version and malformed stop requests fail closed without creating events',async()=>{
 const queries=[];
 const db={query:async(sql)=>{queries.push(sql);return {rows:[]};}};
 assert.deepEqual(await setExecutionControl({db,action:'resume',expectedVersion:4,
  reason:'restore-after-validation'}),{ok:false,error:'version-conflict'});
 await assert.rejects(setExecutionControl({db,action:'pause',expectedVersion:-1,reason:'x'}),
  /invalid-stop-request/);
 assert.equal(queries.length,1);
});
test('stop status readback validates the durable row before granting any authority',async()=>{
 const db={query:async()=>({rows:[{paused:true,version:4,updated_at:'2026-10-25T10:05:00.000Z'}]})};
 assert.deepEqual(await readExecutionControl({db}),{
  paused:true,version:4,updatedAt:'2026-10-25T10:05:00.000Z'
 });
 await assert.rejects(readExecutionControl({db:{query:async()=>({rows:[]})}}),
  /stop-control-unavailable/);
});
test('fenced worker does not claim a task when owner has paused execution',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
 const b64=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const core=b64("export async function executeObjective(){throw Error('must-not-execute');}");
 const control=b64("export async function readExecutionControl(){return {paused:true,version:8};}");
 const transformed=source.replace("from 'lib/brain-core.js'","from '"+core+"'")
  .replace("from 'lib/runtime-control.js'","from '"+control+"'");
 const runner=await import(b64(transformed));
 const db={query:async()=>{throw Error('worker must not reach DB claim');}};
 const r=await runner.runOne({db,browser:{}});
 assert.equal(r.status,'paused');
 assert.equal(r.controlVersion,8);
});
test('Mahoraga prepared external writes obey stop without preventing reconciliation',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/lib/mahoraga-actions.js',import.meta.url),'utf8');
 assert.match(source,/owner-execution-paused/);
 assert.match(source,/brain_runtime_control/);
 assert.match(source,/row\.state==='prepared'/);
});
test('scheduler loop treats a paused result as terminal rather than re-running it',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/api/brain/run.js',import.meta.url),'utf8');
 assert.match(source,/result\.status==='paused'/);
});
test('owner control endpoint is admin-only with read and explicit pause/resume actions',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/api/brain/control.js',import.meta.url),'utf8');
 assert.match(source,/export const access='admin'/);
 assert.match(source,/export const methods=\['GET','POST'\]/);
 assert.match(source,/setExecutionControl/);
});
test('stop migration preserves prior ledger and seeds a single control row',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/migrations/0010_runtime_stop.sql',import.meta.url),'utf8');
 assert.match(source,/CREATE TABLE IF NOT EXISTS brain_runtime_control/);
 assert.match(source,/INSERT INTO brain_runtime_control/);
 assert.doesNotMatch(source,/TRUNCATE|DROP TABLE|DELETE FROM brain_events/i);
});
