import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuumOutbox} from '../src/continuum-outbox.mjs';
import {slotKey,classifySlot,planRecovery} from '../src/scheduler/slot-ledger.mjs';
import {providerAuthorizationPlan} from '../src/provider-authority.mjs';

const NOW = '2026-11-22T20:00:00.000Z';
const SHA = 'a'.repeat(40);
const signed = 'b'.repeat(64);
const request = 'c'.repeat(64);
function intent(i=0) {
  const key=String(i).padStart(6,'0');
  return {
    taskId:100+i, objectiveId:'objective-adversarial-'+key,
    deliveryId:'delivery-adversarial-'+key,
    idempotencyKey:'idempotency-adversarial-'+key,
    repository:'michaeljwilliams0123/Ultron.MW',
    sourceSha:SHA, authoritySha:signed, requestSha:request,
    leaseGeneration:9, expiresAt:'2026-11-24T20:00:00Z',
    effect:'read',maxPaidCents:0
  };
}
function ledger() {
  const entries=new Map(), keyToDelivery=new Map();
  const metrics={insertAttempts:0, inserted:0, updates:0, selects:0};
  return {entries,metrics,async query(sql,params=[]) {
    if(sql.includes('INSERT INTO brain_continuum_outbox')) {
      metrics.insertAttempts++;
      const [taskId,objectiveId,deliveryId,idempotencyKey,repository,sourceSha,
        authoritySha,requestSha,leaseGeneration,expiresAt,effect,maxPaidCents]=params;
      if(entries.has(deliveryId)||keyToDelivery.has(idempotencyKey))return {rows:[]};
      entries.set(deliveryId,{taskId,objectiveId,deliveryId,idempotencyKey,repository,
        sourceSha,authoritySha,requestSha,leaseGeneration,expiresAt,effect,maxPaidCents,state:'pending'});
      keyToDelivery.set(idempotencyKey,deliveryId);
      metrics.inserted++;
      return {rows:[{deliveryId,state:'pending'}]};
    }
    if(sql.includes('SELECT')&&sql.includes('FROM brain_continuum_outbox')) {
      metrics.selects++;
      const r=entries.get(params[0]);return {rows:r?[{...r}]:[]};
    }
    if(sql.includes('UPDATE brain_continuum_outbox')) {
      metrics.updates++;
      const r=entries.get(params[0]);
      if(!r||r.sourceSha!==params[1]||r.leaseGeneration!==params[2]||r.state!=='pending')return {rows:[]};
      r.state='reconcile-required';
      return {rows:[{deliveryId:r.deliveryId,state:r.state}]};
    }
    throw Error('Unexpected SQL operation');
  }};
}
function service(db,clock=()=>NOW) {return createContinuumOutbox({db,now:clock});}

test('1,200 adversarial admission mutations fail closed BEFORE any SQL, including cost, repo, scope, expiry and coercion',async()=>{
  for(let i=0;i<1200;i++){
    const db=ledger(),c=intent(i);
    switch(i%12){
      case 0:c.maxPaidCents=1+(i%100);break;
      case 1:c.maxPaidCents='0';break;
      case 2:c.effect='write';break;
      case 3:c.effect='admin';break;
      case 4:c.repository='attacker/other-repo';break;
      case 5:c.sourceSha=SHA.toUpperCase();break;
      case 6:c.authoritySha=String(i);break;
      case 7:c.requestSha='a'.repeat(63);break;
      case 8:c.leaseGeneration=0;break;
      case 9:c.expiresAt='2026-11-01T00:00:00Z';break;
      case 10:c.expiresAt='2027-02-01T00:00:00Z';break;
      case 11:c.taskId={valueOf(){throw Error('coercion')}};break;
    }
    await assert.rejects(service(db).reserve(c),/continuum-outbox-/);
    assert.equal(db.metrics.insertAttempts,0,'invalid request was sent to SQL');
  }
});
test('512 independent owner-scoped durable intents survive concurrent admission with no collisions',async()=>{
  const db=ledger(),outbox=service(db);
  const result=await Promise.all(Array.from({length:512},(_,i)=>outbox.reserve(intent(i))));
  assert.equal(result.filter(r=>r.created).length,512);
  assert.equal(db.entries.size,512);
  assert.equal(db.metrics.inserted,512);
  assert.equal(new Set([...db.entries.values()].map(x=>x.idempotencyKey)).size,512);
  assert.ok([...db.entries.values()].every(x=>x.maxPaidCents===0&&x.repository==='michaeljwilliams0123/Ultron.MW'));
});
test('1,024 concurrent same-key submissions produce one persisted effect, and each replay is read back',async()=>{
  const db=ledger(),outbox=service(db);
  const results=await Promise.all(Array.from({length:1024},()=>outbox.reserve(intent(31))));
  assert.equal(results.filter(x=>x.created).length,1);
  assert.equal(results.filter(x=>!x.created).length,1023);
  assert.equal(db.entries.size,1);
  assert.equal(db.metrics.inserted,1);
  assert.equal(db.metrics.selects,1024);
});
test('128 conflicting replay mutations cannot impersonate an existing signed intent',async()=>{
  const db=ledger(),outbox=service(db);
  await outbox.reserve(intent(12));
  const attempted=[
    {sourceSha:'d'.repeat(40)},{authoritySha:'d'.repeat(64)},
    {requestSha:'d'.repeat(64)},{leaseGeneration:10},
    {objectiveId:'other-objective-00001'},{idempotencyKey:'other-key-000000001'},
    {taskId:8000},{effect:'advisory'}
  ];
  for(let i=0;i<128;i++){
    await assert.rejects(outbox.reserve({...intent(12),...attempted[i%attempted.length]}),/delivery-conflict/);
  }
  assert.equal(db.entries.size,1);
  assert.equal(db.metrics.inserted,1);
});
test('256 parallel stale-fence and forged-source transitions cannot mutate pending intent',async()=>{
  const db=ledger(),outbox=service(db);
  await outbox.reserve(intent(77));
  const tries=Array.from({length:256},(_,i)=>outbox.markUnknown({
    deliveryId:intent(77).deliveryId,
    sourceSha:i%2?SHA:'d'.repeat(40),
    leaseGeneration:i%2?8:9
  }));
  const results=await Promise.allSettled(tries);
  assert.equal(results.filter(x=>x.status==='rejected').length,256);
  assert.equal(db.entries.get(intent(77).deliveryId).state,'pending');
  assert.equal(db.metrics.updates,256);
});
test('256 concurrent exact-source fenced transitions produce one state change',async()=>{
  const db=ledger(),outbox=service(db);
  await outbox.reserve(intent(88));
  const results=await Promise.all(Array.from({length:256},()=>outbox.markUnknown({
    deliveryId:intent(88).deliveryId,sourceSha:SHA,leaseGeneration:9
  })));
  assert.equal(results.filter(x=>x.changed).length,1);
  assert.equal(results.filter(x=>!x.changed).length,255);
  assert.equal(db.entries.get(intent(88).deliveryId).state,'reconcile-required');
  assert.equal(db.metrics.updates,256);
});
test('lost INSERT acknowledgement is independently read back and never retried as a second write',async()=>{
  const db=ledger(),q=db.query.bind(db);let failed=false;
  db.query=async(sql,p)=>{
    const x=await q(sql,p);
    if(sql.includes('INSERT INTO brain_continuum_outbox')&&!failed){failed=true;throw Error('transport ack lost');}
    return x;
  };
  const result=await service(db).reserve(intent(44));
  assert.deepEqual(result,{created:false,deliveryId:intent(44).deliveryId,state:'pending',reconciled:true});
  assert.equal(db.metrics.insertAttempts,1);assert.equal(db.metrics.inserted,1);
});
test('lost UPDATE acknowledgement is independently read back and never retried as a second transition',async()=>{
  const db=ledger(),q=db.query.bind(db);let failed=false;
  db.query=async(sql,p)=>{
    const x=await q(sql,p);
    if(sql.includes('UPDATE brain_continuum_outbox')&&!failed){failed=true;throw Error('transport ack lost');}
    return x;
  };
  const outbox=service(db);
  await outbox.reserve(intent(59));
  const result=await outbox.markUnknown({deliveryId:intent(59).deliveryId,sourceSha:SHA,leaseGeneration:9});
  assert.equal(result.reconciled,true);
  assert.equal(result.changed,false);
  assert.equal(db.metrics.updates,1);
});
test('durable row with forged authoritative SHA fails receipt validation, even after INSERT ACK',async()=>{
  const db=ledger(),q=db.query.bind(db);
  db.query=async(sql,p)=>{
    const x=await q(sql,p);
    if(sql.includes('SELECT')&&sql.includes('FROM brain_continuum_outbox')&&x.rows[0])
      return {rows:[{...x.rows[0],authoritySha:'f'.repeat(64)}]};
    return x;
  };
  await assert.rejects(service(db).reserve(intent(63)),/admission-readback-mismatch/);
  assert.equal(db.metrics.inserted,1);
});
test('clock expiration AFTER a successful durable write never returns false acceptance',async()=>{
  const db=ledger();let ticks=0;
  const outbox=service(db,()=>++ticks===1?NOW:'2026-11-25T00:00:00Z');
  await assert.rejects(outbox.reserve(intent(70)),/reconcile-required/);
  assert.equal(db.metrics.inserted,1);
});
test('8,760 hourly scheduler classifications preserve actual timing, not recovery as on-time proof',()=>{
  const base=Date.parse('2026-01-01T00:00:00Z');
  for(let i=0;i<8760;i++){
    const hour=new Date(base+i*3600000).toISOString().slice(0,13)+':00Z';
    const ontime=classifySlot({scheduledHour:hour,actualPickupAt:new Date(base+i*3600000+27*60000).toISOString(),completionStatus:'done'});
    const late=classifySlot({scheduledHour:hour,actualPickupAt:new Date(base+i*3600000+34*60000).toISOString(),completionStatus:'done'});
    const recovered=classifySlot({scheduledHour:hour,actualPickupAt:new Date(base+i*3600000+27*60000).toISOString(),completionStatus:'done',recovery:true});
    assert.equal(ontime.pickupLagSeconds,600);assert.equal(ontime.primaryOnTime,true);
    assert.equal(late.pickupLagSeconds,1020);assert.equal(late.primaryOnTime,false);
    assert.equal(late.sloBreach,true);
    assert.equal(recovered.primaryOnTime,false);
    assert.equal(recovered.sloBreach,true);
    assert.equal(slotKey(hour),hour);
  }
});
test('10,000 recovery-window permutations never schedule duplicate or stale UTC slots',()=>{
  const now='2026-11-22T20:38:00Z';
  const entire=planRecovery({now,existingKeys:[],lookbackHours:6});
  assert.equal(entire.length,6);
  for(let mask=0;mask<64;mask++){
    const known=entire.filter((_,i)=>Boolean(mask&(1<<i)));
    const planned=planRecovery({now,existingKeys:known,lookbackHours:6});
    assert.equal(planned.length,6-known.length);
    assert.equal(new Set(planned).size,planned.length);
    assert.ok(planned.every(x=>entire.includes(x)&&!known.includes(x)));
  }
  let seed=0x156feda;
  for(let i=0;i<9936;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const known=entire.filter((_,j)=>Boolean(seed&(1<<j)));
    const planned=planRecovery({now,existingKeys:known,lookbackHours:6});
    assert.equal(new Set(planned).size,planned.length);
    assert.ok(planned.every(x=>entire.includes(x)&&!known.includes(x)));
  }
});
test('model-provider authorization never converts credential presence into verified authority',()=>{
  const secret='private-test-credential-'+ 'x'.repeat(64);
  for(const name of ['datadog','huggingface','github']){
    const result=providerAuthorizationPlan(name,{env:{ULTRON_DATADOG_API_KEY:secret,ULTRON_ENABLE_DATADOG:'1'}});
    assert.equal(result.credentialValue,null);
    assert.equal(JSON.stringify(result).includes(secret),false);
  }
  assert.equal(providerAuthorizationPlan('datadog',{env:{ULTRON_DATADOG_API_KEY:secret,ULTRON_ENABLE_DATADOG:'1'}}).status,'configured-not-verified');
  assert.equal(providerAuthorizationPlan('huggingface').status,'local-public');
  assert.throws(()=>providerAuthorizationPlan('custom-admin'),/Unsupported/);
});
