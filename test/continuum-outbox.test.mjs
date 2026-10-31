import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContinuumOutbox} from '../src/continuum-outbox.mjs';

const NOW='2026-10-31T20:00:00.000Z';
const contract=()=>({
  taskId:71,objectiveId:'continuum-c01-objective-01',
  deliveryId:'continuum-delivery-0001',idempotencyKey:'continuum:delivery:0001',
  repository:'michaeljwilliams0123/Ultron.MW',
  sourceSha:'a'.repeat(40),authoritySha:'b'.repeat(64),
  requestSha:'c'.repeat(64),leaseGeneration:2,
  expiresAt:'2026-11-01T20:00:00.000Z',
  effect:'read',maxPaidCents:0
});
const fakeDb=()=>{
  const statements=[],entries=new Map();
  return {statements,entries,async query(sql,params=[]){
    statements.push({sql,params});
    if(sql.includes('INSERT INTO brain_continuum_outbox')){
      const [taskId,objectiveId,deliveryId,idempotencyKey,repository,sourceSha,
        authoritySha,requestSha,leaseGeneration,expiresAt,effect,maxPaidCents]=params;
      if(entries.has(deliveryId))return {rows:[]};
      const row={taskId,objectiveId,deliveryId,idempotencyKey,repository,sourceSha,
        authoritySha,requestSha,leaseGeneration,expiresAt,effect,maxPaidCents,state:'pending'};
      entries.set(deliveryId,row);
      return {rows:[{deliveryId,state:'pending'}]};
    }
    if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox')){
      const row=entries.get(params[0]);return {rows:row?[{...row}]:[]};
    }
    if(sql.includes('UPDATE brain_continuum_outbox')){
      const row=entries.get(params[0]);
      if(!row||row.sourceSha!==params[1]||row.leaseGeneration!==params[2]||
        row.state!=='pending')return {rows:[]};
      row.state='reconcile-required';return {rows:[{deliveryId:row.deliveryId,state:row.state}]};
    }
    throw Error('unexpected SQL: '+sql.slice(0,100));
  }};
};

test('reserve atomically records a zero-cost, source-and-fence-bound intent before any dispatch',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  const r=await outbox.reserve(contract());
  assert.deepEqual(r,{created:true,deliveryId:contract().deliveryId,state:'pending'});
  const sql=db.statements[0];
  assert.match(sql.sql,/INSERT INTO brain_continuum_outbox/);
  assert.match(sql.sql,/ON CONFLICT\(delivery_id\) DO NOTHING/);
  assert.equal(sql.params[11],0);
  assert.equal(db.statements.length,1);
  assert.equal(typeof outbox.dispatch,'undefined');
});

test('duplicate identical delivery is read back and never inserted again',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  assert.deepEqual(await outbox.reserve(contract()),{
    created:false,deliveryId:contract().deliveryId,state:'pending'
  });
  assert.equal(db.entries.size,1);
});

test('same delivery ID with different objective/source/authority/request/fence fails closed',async()=>{
  for(const change of [
    {objectiveId:'continuum-c01-objective-02'},
    {sourceSha:'d'.repeat(40)},{authoritySha:'d'.repeat(64)},
    {requestSha:'d'.repeat(64)},{leaseGeneration:3},
    {idempotencyKey:'continuum:delivery:0002'}
  ]){
    const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
    await outbox.reserve(contract());
    await assert.rejects(outbox.reserve({...contract(),...change}),/delivery-conflict/);
    assert.equal(db.entries.size,1);
  }
});

test('uncertain response records reconcile-required using exact source and fencing CAS',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  assert.equal((await outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
  })).changed,true);
  assert.equal(db.entries.get(contract().deliveryId).state,'reconcile-required');
  assert.equal((await outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
  })).changed,false);
  assert.equal(db.statements.filter(x=>x.sql.includes('UPDATE brain_continuum_outbox')).length,2);
});

test('stale fence and wrong source cannot advance a pending intent',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  await assert.rejects(outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:'d'.repeat(40),leaseGeneration:2
  }),/fence-or-source-conflict/);
  await assert.rejects(outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:1
  }),/fence-or-source-conflict/);
  assert.equal(db.entries.get(contract().deliveryId).state,'pending');
});

test('expired, metered, malformed and unbounded admission is rejected before any SQL',async()=>{
  for(const change of [
    {maxPaidCents:1},{maxPaidCents:-1},{sourceSha:'main'},
    {authoritySha:'token'}, {expiresAt:'2026-10-30T20:00:00Z'},
    {expiresAt:'2027-01-01T20:00:00Z'}, {leaseGeneration:0},
    {effect:'write'}, {repository:'attacker/repo'}, {taskId:0},
    {deliveryId:['continuum-delivery-0001']}
  ]){
    const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
    await assert.rejects(outbox.reserve({...contract(),...change}),/invalid|denied|expired/);
    assert.equal(db.statements.length,0);
  }
});

test('migration fences identity, forbids deletion and enforces monotonic state',()=>{
  const sql=readFileSync(new URL('../cloud/hatchable/migrations/0013_continuum_outbox.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS brain_continuum_outbox/);
  assert.match(sql,/UNIQUE.*delivery_id|delivery_id text NOT NULL UNIQUE/i);
  assert.match(sql,/max_paid_cents.*CHECK.*= 0/i);
  assert.match(sql,/CREATE TRIGGER.*continuum_outbox_guard/is);
  assert.match(sql,/TG_OP = 'DELETE'/);
  assert.match(sql,/OLD\.state = 'pending'.*NEW\.state = 'reconcile-required'/s);
});
