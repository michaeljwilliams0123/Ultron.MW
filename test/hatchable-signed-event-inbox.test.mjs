import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifySignedEvent,admitSignedEvent} from '../cloud/hatchable/lib/signed-event-inbox.js';

const subtle=webcrypto.subtle;
const secret='independently-owned-event-bridge-secret-32bytes!';
const payload={schema:'ultron.signed-event.v1',
 source:'github-bridge',deliveryId:'delivery-20261025-0001',objective:'repo.inspect'};
async function signature(raw,timestamp,secretValue=secret){
 const key=await subtle.importKey('raw',new TextEncoder().encode(secretValue),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const s=await subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));
 return 'sha256='+Array.from(new Uint8Array(s),b=>b.toString(16).padStart(2,'0')).join('');
}
async function verified(obj=payload){
 const raw=JSON.stringify(obj),timestamp=String(Math.floor(Date.now()/1000));
 return verifySignedEvent({raw,timestamp,signature:await signature(raw,timestamp),
  secret,now:Number(timestamp)*1000,subtle});
}
function database({queueCount=0}={}){
 const state={queued:queueCount,rows:new Map(),sql:[]};
 return {state,async query(sql,params=[]){
  state.sql.push({sql,params});
  if(sql.includes('count(*)'))return {rows:[{n:state.queued}]};
  if(sql.includes('INSERT INTO brain_signed_inbox')){
   const key=params[0]+':'+params[1];
   if(state.rows.has(key))return {rows:[]};
   state.rows.set(key,params[3]);state.queued++;
   return {rows:[{id:99,task_id:43,task_key:params[2]}]};
  }
  if(sql.includes('SELECT payload_sha256')){
   const key=params[0]+':'+params[1];
   return {rows:state.rows.has(key)?[{payload_sha256:state.rows.get(key)}]:[]};
  }
  throw Error('unexpected statement');
 }};
}
test('verified signed event uses original bytes, bounded timestamp and a deterministic task identity',async()=>{
 const event=await verified();
 assert.equal(event.verified,true);
 assert.equal(event.source,'github-bridge');
 assert.equal(event.objective,'repo.inspect');
 assert.match(event.payloadSha256,/^[a-f0-9]{64}$/);
 assert.match(event.taskKey,/^webhook-[a-f0-9]{40}$/);
 assert.equal('raw' in event,false);
 assert.equal('secret' in event,false);
});
test('any payload change under old signature fails HMAC verification',async()=>{
 const raw=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000));
 await assert.rejects(verifySignedEvent({raw:JSON.stringify({...payload,objective:'repo.ci'}),
  timestamp,signature:await signature(raw,timestamp),secret,
  now:Number(timestamp)*1000,subtle}),/event-signature-invalid/);
});
test('future and old events outside the five-minute window are denied',async()=>{
 const raw=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000));
 const signed=await signature(raw,timestamp),now=Number(timestamp)*1000;
 await assert.rejects(verifySignedEvent({raw,timestamp,signature:signed,secret,
  now:now+301000,subtle}),/event-timestamp-expired/);
 await assert.rejects(verifySignedEvent({raw,timestamp,signature:signed,secret,
  now:now-301000,subtle}),/event-timestamp-expired/);
});
test('privileged external-write objectives are never admitted by the initial event bridge',async()=>{
 await assert.rejects(verified({...payload,objective:'repo.pr.squash'}),/unsupported-event-objective/);
 await assert.rejects(verified({...payload,objective:'permissions.change'}),/unsupported-event-objective/);
});
test('an unverified JSON object cannot be inserted into durable task state',async()=>{
 const db=database();let scheduled=0;
 await assert.rejects(admitSignedEvent({db,event:{...payload,verified:true},
  scheduler:{now:async()=>{scheduled++;}}}),/unverified-event/);
 assert.equal(db.state.sql.length,0);assert.equal(scheduled,0);
});
test('one verified delivery creates atomic inbox, objective and sanitized receipt',async()=>{
 const db=database(),calls=[];
 const event=await verified();
 const result=await admitSignedEvent({db,event,scheduler:{now:async(...a)=>calls.push(a)}});
 assert.equal(result.ok,true);assert.equal(result.created,true);
 assert.equal(result.taskId,43);
 const insert=db.state.sql.find(x=>x.sql.includes('INSERT INTO brain_signed_inbox'));
 assert.ok(insert);
 assert.match(insert.sql,/INSERT INTO brain_signed_inbox/);
 assert.match(insert.sql,/INSERT INTO brain_tasks/);
 assert.match(insert.sql,/INSERT INTO brain_events/);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0],['/api/brain/run',{via:'signed-event'}]);
 assert.equal(JSON.stringify(db.state.sql).includes(secret),false);
});
test('duplicate delivery never queues another task or schedules execution twice',async()=>{
 const db=database(),calls=[];
 const event=await verified(),scheduler={now:async()=>calls.push(1)};
 const a=await admitSignedEvent({db,event,scheduler});
 const b=await admitSignedEvent({db,event,scheduler});
 assert.equal(a.created,true);assert.equal(b.created,false);
 assert.equal(b.reason,'duplicate-delivery');
 assert.equal(calls.length,1);
});
test('same delivery identity with different payload is a conflict rather than a silent duplicate',async()=>{
 const db=database(),scheduler={now:async()=>{}};
 await admitSignedEvent({db,event:await verified(),scheduler});
 const changed=await verified({...payload,objective:'repo.ci'});
 await assert.rejects(admitSignedEvent({db,event:changed,scheduler}),/delivery-id-conflict/);
});
test('full queue is rejected before insertion, while scheduling failure leaves admitted work durable',async()=>{
 const full=database({queueCount:100}),event=await verified();
 const rejected=await admitSignedEvent({db:full,event,scheduler:{now:async()=>{}}});
 assert.equal(rejected.ok,false);assert.equal(rejected.error,'queue-full');
 assert.equal(full.state.rows.size,0);
 const db=database();
 const allowed=await admitSignedEvent({db,event,scheduler:{now:async()=>{throw Error('offline');}}});
 assert.equal(allowed.created,true);assert.equal(allowed.immediateScheduled,false);
 assert.equal(allowed.fallback,'hourly');
});

test('an array-valued signed delivery ID cannot become an ambiguous SQL identity',async()=>{
 await assert.rejects(verified({...payload,deliveryId:['delivery-20261025-0001']}),
  /event-payload-invalid/);
});
test('already-seen deliveries are reported as duplicates even when new work is at capacity',async()=>{
 const db=database({queueCount:99}),scheduler={now:async()=>{}};
 const e=await verified();
 assert.equal((await admitSignedEvent({db,event:e,scheduler})).created,true);
 const repeat=await admitSignedEvent({db,event:e,scheduler});
 assert.deepEqual(repeat,{ok:true,created:false,reason:'duplicate-delivery'});
});
test('an unrelated existing objective key must not be suppressed as a successful admission',async()=>{
 const db=database(),e=await verified();
 await admitSignedEvent({db,event:e,scheduler:{now:async()=>{}}});
 const insert=db.state.sql.find(x=>x.sql.includes('INSERT INTO brain_signed_inbox')).sql;
 assert.doesNotMatch(insert,/ON CONFLICT\(task_key\) DO NOTHING/);
});
