import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {canonicalJson} from '../src/verification/canonical_json.mjs';
import {createHatchableReadbackReporter} from '../cloud/hatchable/lib/readback-oracle-reporter.js';

const migration=readFileSync(new URL('../cloud/hatchable/migrations/0038_readback_oracle_events.sql',import.meta.url),'utf8');

function event(attemptId='attempt-001',status='verified-external'){
 const unsigned={schema:'ultron.readback-oracle.v1',attemptId,status,
  checks:[{checkType:'github_api_readback',tier:'provider-state',ok:true,reason:'matched',
   targetDigest:'a'.repeat(64),expectedDigest:'b'.repeat(64)}],
  verifiedAt:'2026-11-09T19:45:00.000Z'};
 return {...unsigned,evidenceDigest:createHash('sha256').update(canonicalJson(unsigned)).digest('hex')};
}
function database(){
 const entries=new Map(),sql=[];
 return {sql,query:async(statement,params)=>{
  sql.push({statement,params});
  if(statement.includes('INSERT INTO brain_readback_oracle_events')){
   const [id,digest,status,raw]=params;
   if(entries.has(id))return {rows:[]};
   entries.set(id,{attemptId:id,evidenceDigest:digest,status,event:JSON.parse(raw)});
   return {rows:[{attemptId:id}]};
  }
  if(statement.includes('SELECT attempt_id AS')){
   const item=entries.get(params[0]);return {rows:item?[item]:[]};
  }
  throw Error('unexpected query');
 }};
}
test('durable Hatchable writer inserts only immutable bound evidence, then rereads',async()=>{
 const db=database(),reporter=createHatchableReadbackReporter(db),e=event();
 assert.deepEqual(await reporter.write(e),{ok:true});
 assert.deepEqual(await reporter.read(e.attemptId),e);
 assert.equal(db.sql[0].params[0],e.attemptId);
 assert.equal(db.sql[0].params[1],e.evidenceDigest);
 assert.match(db.sql[0].statement,/ON CONFLICT.*DO NOTHING/);
 assert.deepEqual(await reporter.write(e),{ok:true},'duplicate event must be idempotent');
});
test('replayed attempt with changed digest is rejected without overwrite',async()=>{
 const db=database(),reporter=createHatchableReadbackReporter(db),e=event();
 await reporter.write(e);
 const other=event();other.verifiedAt='2026-11-09T19:45:01.000Z';
 const {evidenceDigest,...unsigned}=other;
 other.evidenceDigest=createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
 await assert.rejects(reporter.write(other),/oracle-receipt-conflict/);
 assert.deepEqual(await reporter.read(e.attemptId),e);
});
test('cannot mark an HTTP-only observation as a verified external effect',async()=>{
 const db=database(),reporter=createHatchableReadbackReporter(db);
 const e=event();e.checks=[{...e.checks[0],checkType:'http_status',tier:'transport-only'}];
 const {evidenceDigest,...unsigned}=e;
 e.evidenceDigest=createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
 await assert.rejects(reporter.write(e),/oracle-event-invalid/);
 assert.equal(db.sql.length,0);
});
test('cannot persist tampered or secret-containing events',async()=>{
 const db=database(),reporter=createHatchableReadbackReporter(db);
 await assert.rejects(reporter.write({...event(),evidenceDigest:'f'.repeat(64)}),/oracle-event-invalid/);
 await assert.rejects(reporter.write({...event(),privateKey:'never'}),/oracle-event-invalid/);
 assert.equal(db.sql.length,0);
});

test('PGlite JSONB reordering preserves digest validation and replay semantics',async()=>{
 const db=new PGlite();
 try{
  await db.exec(migration);
  const reporter=createHatchableReadbackReporter(db),e=event('attempt-pglite-001');
  await reporter.write(e);
  const stored=(await db.query('SELECT event FROM brain_readback_oracle_events WHERE attempt_id=$1',[e.attemptId])).rows[0].event;
  assert.notEqual(JSON.stringify(stored),JSON.stringify(e),'PostgreSQL JSONB must reorder event keys');
  assert.deepEqual(await reporter.read(e.attemptId),e);
  assert.deepEqual(await reporter.write(e),{ok:true},'duplicate event must be idempotent');
  const conflict=event(e.attemptId);conflict.verifiedAt='2026-11-09T19:45:01.000Z';
  const {evidenceDigest,...unsigned}=conflict;
  conflict.evidenceDigest=createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  await assert.rejects(reporter.write(conflict),/oracle-receipt-conflict/);
  assert.deepEqual(await reporter.read(e.attemptId),e,'conflicting replay must not overwrite the original');
 }finally{
  await db.close();
 }
});
