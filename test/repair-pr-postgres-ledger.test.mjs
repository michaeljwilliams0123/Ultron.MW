import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPostgresRepairLedger } from '../src/repair-pr-postgres-ledger.mjs';

const KEY='repair:seeded-pr-001', A='a'.repeat(64), B='b'.repeat(64);
function mockDatabase(){
  const state=new Map();
  const calls=[];
  return {
    calls,
    async query(sql,params){
      calls.push({sql,params});
      if(sql.includes('INSERT INTO repair_pr_attempts')){
        if(state.has(params[0]))return {rows:[]};
        const row={attempt_key:params[0],fingerprint:params[1],
          phase:'reserved',pr_number:null};
        state.set(params[0],row);return {rows:[{...row}]};
      }
      if(sql.includes('SELECT')&&sql.includes('repair_pr_attempts')){
        const row=state.get(params[0]);return {rows:row?[{...row}]:[]};
      }
      if(sql.includes('UPDATE repair_pr_attempts')){
        const row=state.get(params[0]);
        if(!row||row.fingerprint!==params[1]||row.phase!==params[2])
          return {rows:[]};
        row.phase=params[3];row.pr_number=params[4]??row.pr_number;
        return {rows:[{attempt_key:params[0]}]};
      }
      throw Error('Unexpected database query');
    },
    state
  };
}
test('Postgres claim persists idempotency key and returns existing fingerprint',async()=>{
  const db=mockDatabase(),ledger=createPostgresRepairLedger({db});
  const first=await ledger.claim({key:KEY,fingerprint:A});
  assert.equal(first.claimed,true);
  assert.equal(first.entry.phase,'reserved');
  const replay=await ledger.claim({key:KEY,fingerprint:A});
  assert.equal(replay.claimed,false);
  assert.equal(replay.entry.fingerprint,A);
  assert.equal(db.state.size,1);
});
test('Postgres CAS advances exact expected phases and stores PR number',async()=>{
  const db=mockDatabase(),ledger=createPostgresRepairLedger({db});
  await ledger.claim({key:KEY,fingerprint:A});
  for(const [from,to] of [['reserved','branch-dispatch'],['branch-dispatch','branch-confirmed'],
    ['branch-confirmed','pr-dispatch'],['pr-dispatch','complete']]){
    assert.equal(await ledger.advance({key:KEY,fingerprint:A,from,to,
      ...(to==='complete'?{prNumber:78}:{})}),true);
    assert.equal(await ledger.advance({key:KEY,fingerprint:A,from,to,
      ...(to==='complete'?{prNumber:78}:{})}),false);
  }
  const receipt=await ledger.get(KEY);
  assert.equal(receipt.phase,'complete');
  assert.equal(receipt.prNumber,78);
});
test('wrong fingerprint and invalid transitions never mutate persisted phase',async()=>{
  const db=mockDatabase(),ledger=createPostgresRepairLedger({db});
  await ledger.claim({key:KEY,fingerprint:A});
  await assert.rejects(ledger.claim({key:KEY,fingerprint:B}),/fingerprint collision/);
  assert.equal(await ledger.advance({key:KEY,fingerprint:B,from:'reserved',to:'branch-dispatch'}),false);
  await assert.rejects(ledger.advance({key:KEY,fingerprint:A,from:'reserved',to:'complete'}),/transition/);
  assert.equal((await ledger.get(KEY)).phase,'reserved');
});
test('invalid IDs, SQL injection, missing PG adapter and wrong PR numbers are rejected',async()=>{
  assert.throws(()=>createPostgresRepairLedger({}),/PostgreSQL/);
  const ledger=createPostgresRepairLedger({db:mockDatabase()});
  await assert.rejects(ledger.claim({key:"repair:abc';DROP TABLE attempts;",fingerprint:A}),/idempotency/);
  await assert.rejects(ledger.claim({key:KEY,fingerprint:'0'}),/fingerprint/);
  await ledger.claim({key:KEY,fingerprint:A});
  await assert.rejects(ledger.advance({key:KEY,fingerprint:A,from:'reserved',
    to:'branch-dispatch',prNumber:99}),/PR number/);
  await assert.rejects(ledger.advance({key:KEY,fingerprint:A,from:'pr-dispatch',
    to:'complete',prNumber:0}),/PR number/);
});


test('live PostgreSQL repair fence test uses new disposable database, never drops shared table',()=>{
 const script=readFileSync(new URL('./repair-pr-postgres-live.test.mjs',import.meta.url),'utf8');
 assert.match(script,/CREATE DATABASE/);
 assert.match(script,/ultron_repair_ci_/);
 assert.doesNotMatch(script,/DROP TABLE IF EXISTS repair_pr_attempts CASCADE/i);
});

test('live PostgreSQL fixture requires the exact CI service container and an ephemeral marker',()=>{
 const script=readFileSync(new URL('./repair-pr-postgres-live.test.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
 assert.match(script,/process\.env\.ULTRON_POSTGRES_CONTAINER_ID/);
 assert.match(script,/ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1/);
 assert.match(script,/execFileSync\('docker',\s*\['inspect'/);
 assert.doesNotMatch(script,/\['ps','--filter','ancestor=postgres:16-alpine'/);
 assert.match(workflow,/ULTRON_POSTGRES_CONTAINER_ID: \$\{\{ job\.services\.postgres\.id \}\}/);
 assert.match(workflow,/ULTRON_TEST_POSTGRES: repair-ci-ephemeral-v1/);
});

test('Repair App PostgreSQL preflight rejects untrusted Docker services before any exec',async()=>{
 const {assertEphemeralPostgresService}=await import('../src/repair-postgres-preflight.mjs');
 const id='a'.repeat(64);
 const valid=()=>({Id:id,Config:{Image:'postgres:16-alpine',Env:[
  'ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1','POSTGRES_USER=ultron','POSTGRES_DB=ultron'
 ]},State:{Running:true},Mounts:[{Type:'volume'}]});
 const calls=[];
 const runDocker=args=>{calls.push(args);return JSON.stringify(valid());};
 assert.equal(assertEphemeralPostgresService({containerId:id,runDocker}),id);
 assert.deepEqual(calls,[['inspect','--format','{{json .}}',id]]);
 const invalid=[
  {label:'wrong container ID',id:'invalid;docker exec',detail:valid()},
  {label:'missing ID',id:undefined,detail:valid()},
  {label:'mismatched inspected ID',id,detail:{...valid(),Id:'b'.repeat(64)}},
  {label:'wrong image',id,detail:{...valid(),Config:{...valid().Config,Image:'postgres:latest'}}},
  {label:'stopped container',id,detail:{...valid(),State:{Running:false}}},
  {label:'missing ephemeral marker',id,detail:{...valid(),Config:{...valid().Config,Env:['POSTGRES_USER=ultron','POSTGRES_DB=ultron']}}},
  {label:'wrong database user',id,detail:{...valid(),Config:{...valid().Config,Env:['ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1','POSTGRES_USER=postgres','POSTGRES_DB=ultron']}}},
  {label:'wrong database name',id,detail:{...valid(),Config:{...valid().Config,Env:['ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1','POSTGRES_USER=ultron','POSTGRES_DB=production']}}},
  {label:'bind mount',id,detail:{...valid(),Mounts:[{Type:'bind'}]}},
  {label:'malformed inspect',id,raw:'{not json'},
  {label:'inspect failed',id,throws:true}
 ];
 for(const item of invalid){
  const seen=[];
  assert.throws(()=>assertEphemeralPostgresService({containerId:item.id,runDocker:args=>{
   seen.push(args);
   if(item.throws)throw Error('docker inspect unavailable');
   return item.raw??JSON.stringify(item.detail);
  }}),/repair-postgres-preflight/,item.label);
  assert.ok(seen.every(args=>args[0]==='inspect'),item.label+' must never docker exec');
  if(item.id===undefined||!/^[a-f0-9]{12,64}$/i.test(item.id))
   assert.equal(seen.length,0,item.label+' must reject before Docker access');
 }
});
