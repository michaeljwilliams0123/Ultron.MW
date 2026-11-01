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
      if([...entries.values()].some(row=>row.idempotencyKey===idempotencyKey)){
        if(/ON CONFLICT DO NOTHING/.test(sql))return {rows:[]};
        throw Error('duplicate key value violates unique constraint');
      }
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
  assert.match(sql.sql,/ON CONFLICT DO NOTHING/);
  assert.equal(sql.params[11],0);
  assert.equal(db.statements.length,2);
  assert.match(db.statements[1].sql,/FROM brain_continuum_outbox/);
  assert.deepEqual(db.statements[1].params,[contract().deliveryId]);
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


test('reused idempotency key with a new delivery is a stable conflict, never a raw SQL error',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  await assert.rejects(outbox.reserve({...contract(),deliveryId:'continuum-delivery-0002'}),
    /continuum-outbox-delivery-conflict/);
  assert.equal(db.entries.size,1);
});

test('migration keeps primary key immutable and bounds expiry to 30 days',()=>{
  const sql=readFileSync(new URL('../cloud/hatchable/migrations/0013_continuum_outbox.sql',import.meta.url),'utf8');
  assert.match(sql,/OLD\.id,OLD\.task_id/);
  assert.match(sql,/NEW\.id,NEW\.task_id/);
  assert.match(sql,/expires_at\s*<=\s*created_at\s*\+\s*interval\s*'720 hours'/i);
});


test('outbox migration stamps created_at from statement time and prevents future dating',()=>{
 const sql=readFileSync(new URL('../cloud/hatchable/migrations/0013_continuum_outbox.sql',import.meta.url),'utf8');
 assert.match(sql,/NEW\.created_at\s*:=\s*statement_timestamp\(\)/i);
 assert.match(sql,/BEFORE INSERT ON brain_continuum_outbox/i);
});


test('RED: a successful fenced transition requires matching RETURNING and durable readback',async()=>{
  for(const returned of [
    {deliveryId:'continuum-delivery-foreign',state:'reconcile-required'},
    {deliveryId:contract().deliveryId,state:'pending'},
    {}
  ]){
    const db=fakeDb(),original=db.query.bind(db);
    db.query=async(sql,params)=>{
      const result=await original(sql,params);
      return sql.includes('UPDATE brain_continuum_outbox')?{rows:[returned]}:result;
    };
    const outbox=createContinuumOutbox({db,now:()=>NOW});
    await outbox.reserve(contract());
    await assert.rejects(outbox.markUnknown({
      deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
    }),/continuum-outbox-transition-readback-mismatch/);
  }
});

test('RED: a successful CAS cannot report reconciliation when independent SQL readback is stale',async()=>{
  const db=fakeDb(),original=db.query.bind(db);
  let transitioned=false;
  db.query=async(sql,params)=>{
    const result=await original(sql,params);
    if(sql.includes('UPDATE brain_continuum_outbox'))transitioned=true;
    if(transitioned&&sql.includes('SELECT')&&sql.includes('brain_continuum_outbox')){
      return {rows:result.rows.map(row=>({...row,state:'pending'}))};
    }
    return result;
  };
  const outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  await assert.rejects(outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
  }),/continuum-outbox-transition-readback-mismatch/);
});


test('confirmed CAS holds when fresh readback is absent or has a different fence',async()=>{
  for(const transform of [
    ()=>[],
    rows=>rows.map(row=>({...row,deliveryId:'continuum-delivery-foreign'})),
    rows=>rows.map(row=>({...row,sourceSha:'d'.repeat(40)})),
    rows=>rows.map(row=>({...row,leaseGeneration:3}))
  ]){
    const db=fakeDb(),original=db.query.bind(db);
    let updated=false;
    db.query=async(sql,params)=>{
      const result=await original(sql,params);
      if(sql.includes('UPDATE brain_continuum_outbox'))updated=true;
      if(updated&&sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
        return {rows:transform(result.rows)};
      return result;
    };
    const outbox=createContinuumOutbox({db,now:()=>NOW});
    await outbox.reserve(contract());
    await assert.rejects(outbox.markUnknown({
      deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
    }),/continuum-outbox-transition-readback-mismatch/);
    assert.equal(db.statements.filter(s=>s.sql.includes('UPDATE brain_continuum_outbox')).length,1);
  }
});


test('RED: no-op CAS cannot accept a foreign delivery identity in fresh persisted readback',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  const c=contract();
  await outbox.reserve(c);
  await outbox.markUnknown({deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration});
  const original=db.query.bind(db);
  db.query=async(sql,params)=>{
    const result=await original(sql,params);
    if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
      return {rows:result.rows.map(row=>({...row,deliveryId:'continuum-delivery-foreign'}))};
    return result;
  };
  await assert.rejects(outbox.markUnknown({
    deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
  }),/continuum-outbox-transition-readback-mismatch/);
});

test('RED: successful outbox reservation must verify persisted immutable intent before acknowledging creation',async()=>{
  // A matching INSERT RETURNING id/state alone cannot attest the stored
  // objective, authority, request, cost or fencing contract.
  for(const mutate of [
    // A matching immutable identity is insufficient if the persisted state
    // was already moved out of pending before reservation acknowledgement.
    rows=>rows.map(row=>({...row,state:'reconcile-required'})),
    rows=>rows.map(row=>({...row,authoritySha:'d'.repeat(64)})),
    rows=>rows.map(row=>({...row,requestSha:'d'.repeat(64)})),
    rows=>rows.map(row=>({...row,leaseGeneration:3})),
    rows=>rows.map(row=>({...row,deliveryId:'continuum-delivery-foreign'})),
    ()=>[]
  ]){
    const db=fakeDb(),original=db.query.bind(db);
    let inserted=false;
    db.query=async(sql,params)=>{
      const result=await original(sql,params);
      if(sql.includes('INSERT INTO brain_continuum_outbox'))inserted=true;
      if(inserted&&sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
        return {rows:mutate(result.rows)};
      return result;
    };
    const outbox=createContinuumOutbox({db,now:()=>NOW});
    await assert.rejects(outbox.reserve(contract()),
      /continuum-outbox-admission-readback-mismatch/);
    assert.equal(db.statements.filter(s=>s.sql.includes('INSERT INTO brain_continuum_outbox')).length,1);
  }
});

test('successful outbox reservation is acknowledged only after fresh exact-contract readback',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  assert.deepEqual(await outbox.reserve(contract()),{
    created:true,deliveryId:contract().deliveryId,state:'pending'
  });
  assert.equal(db.statements.filter(s=>s.sql.includes('SELECT')&&s.sql.includes('brain_continuum_outbox')).length,1);
});

test('RED: immutable persisted numeric readback must not coerce invalid cost, task or fence types',async()=>{
  for(const [field,value] of [
    ['maxPaidCents',false],['maxPaidCents',null],['maxPaidCents',''],
    ['maxPaidCents',[]],['taskId',[71]],['leaseGeneration',[2]]
  ]){
    const db=fakeDb(),original=db.query.bind(db);
    db.query=async(sql,params)=>{
      const result=await original(sql,params);
      if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
        return {rows:result.rows.map(row=>({...row,[field]:value}))};
      return result;
    };
    const outbox=createContinuumOutbox({db,now:()=>NOW});
    await assert.rejects(outbox.reserve(contract()),
      /continuum-outbox-admission-readback-mismatch/);
  }
});

test('RED: successful fenced transition rejects coerced persisted lease generation',async()=>{
  const db=fakeDb(),original=db.query.bind(db);
  let transitioned=false;
  db.query=async(sql,params)=>{
    const result=await original(sql,params);
    if(sql.includes('UPDATE brain_continuum_outbox'))transitioned=true;
    if(transitioned&&sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
      return {rows:result.rows.map(row=>({...row,leaseGeneration:[2]}))};
    return result;
  };
  const outbox=createContinuumOutbox({db,now:()=>NOW});
  await outbox.reserve(contract());
  await assert.rejects(outbox.markUnknown({
    deliveryId:contract().deliveryId,sourceSha:contract().sourceSha,leaseGeneration:2
  }),/continuum-outbox-transition-readback-mismatch/);
});

test('canonical persisted bigint strings reject trailing newlines on fresh and duplicate reservation',async()=>{
  for(const duplicate of [false,true]){
    const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
    if(duplicate)await outbox.reserve(contract());
    const original=db.query.bind(db);
    db.query=async(sql,params)=>{
      const result=await original(sql,params);
      if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
        return {rows:result.rows.map(row=>({...row,leaseGeneration:'2\n'}))};
      return result;
    };
    await assert.rejects(outbox.reserve(contract()),
      duplicate?/continuum-outbox-delivery-conflict/:/continuum-outbox-admission-readback-mismatch/);
  }
});

test('no-op fenced reconciliation rejects noncanonical persisted bigint strings',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  const c=contract();
  await outbox.reserve(c);
  await outbox.markUnknown({deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration});
  const original=db.query.bind(db);
  db.query=async(sql,params)=>{
    const result=await original(sql,params);
    if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
      return {rows:result.rows.map(row=>({...row,leaseGeneration:'2\n'}))};
    return result;
  };
  await assert.rejects(outbox.markUnknown({
    deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
  }),/continuum-outbox-fence-or-source-conflict/);
});


test('RED: fenced reconciliation must not certify an unauthorized persisted cost or effect',async()=>{
  for(const altered of [
    {maxPaidCents:1},{maxPaidCents:false},{effect:'write'}
  ]){
    for(const premarked of [false,true]){
      const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
      const c=contract();
      await outbox.reserve(c);
      if(premarked)await outbox.markUnknown({
        deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
      });
      const query=db.query.bind(db);
      db.query=async(sql,params)=>{
        const result=await query(sql,params);
        if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
          return {rows:result.rows.map(row=>({...row,...altered}))};
        return result;
      };
      await assert.rejects(outbox.markUnknown({
        deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
      }),/continuum-outbox-(transition-readback-mismatch|fence-or-source-conflict)/);
    }
  }
});

test('RED: duplicate outbox reservation must not certify an unrecognized persisted state',async()=>{
  for(const foreignState of ['completed','delivered','failed']){
    const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
    await outbox.reserve(contract());
    const query=db.query.bind(db);
    db.query=async(sql,params)=>{
      const result=await query(sql,params);
      if(sql.includes('SELECT')&&sql.includes('brain_continuum_outbox'))
        return {rows:result.rows.map(row=>({...row,state:foreignState}))};
      return result;
    };
    await assert.rejects(outbox.reserve(contract()),/continuum-outbox-delivery-conflict/);
    assert.equal(db.entries.size,1);
  }
});

test('RED: unknown UPDATE response after durable commit reconciles via readback without replay',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  const c=contract();
  await outbox.reserve(c);
  const original=db.query.bind(db);
  let writes=0;
  db.query=async(sql,params)=>{
    if(sql.includes('UPDATE brain_continuum_outbox')){
      writes++;
      await original(sql,params);
      throw Error('simulated lost PostgreSQL UPDATE response');
    }
    return original(sql,params);
  };
  assert.deepEqual(await outbox.markUnknown({
    deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
  }),{changed:false,deliveryId:c.deliveryId,state:'reconcile-required',reconciled:true});
  assert.equal(writes,1,'never replay an uncertain UPDATE');
  assert.equal(db.entries.get(c.deliveryId).state,'reconcile-required');
});

test('RED: unknown UPDATE response before commit stays unresolved, never silently retries',async()=>{
  const db=fakeDb(),outbox=createContinuumOutbox({db,now:()=>NOW});
  const c=contract();
  await outbox.reserve(c);
  const original=db.query.bind(db);
  let writes=0;
  db.query=async(sql,params)=>{
    if(sql.includes('UPDATE brain_continuum_outbox')){
      writes++;
      throw Error('simulated lost response before any commit');
    }
    return original(sql,params);
  };
  await assert.rejects(outbox.markUnknown({
    deliveryId:c.deliveryId,sourceSha:c.sourceSha,leaseGeneration:c.leaseGeneration
  }),/continuum-outbox-reconcile-required/);
  assert.equal(writes,1,'never replay an uncertain UPDATE');
  assert.equal(db.entries.get(c.deliveryId).state,'pending');
});
