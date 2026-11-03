import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {executeCloudNote} from '../cloud/hatchable/lib/cloud-native-action.js';

globalThis.crypto??=webcrypto;
const request=()=>({key:'cloud:note:canary-0001',kind:'observation',
 body:'Bounded cloud action canary',expectedProfileVersion:5,
 expectedStopVersion:3});
function harness({paused=false,allowed=true,lostAck=false,loseEvent=false}={}){
 const notes=new Map(),events=new Map(),calls=[];
 let fail=lostAck;
 return {notes,events,calls,db:{async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('JOIN brain_events e')){
   const row=notes.get(params[0]),receipt=events.get(params[0]);
   return {rows:row&&receipt?[{...row,receiptId:receipt}]:[]};
  }
  if(sql.includes('INSERT INTO brain_notes')){
   assert.match(sql,/JOIN brain_runtime_control/);
   assert.match(sql,/FOR SHARE/);
   assert.match(sql,/max_paid_cents=0/);
   assert.match(sql,/allowed_operations \? 'cloud.note.create'/);
   assert.match(sql,/ON CONFLICT\(action_key\) DO NOTHING/);
   assert.match(sql,/INSERT INTO brain_events/);
   const [key,fingerprint,kind,body,profileVersion,stopVersion]=params;
   if(paused||!allowed||profileVersion!==5||stopVersion!==3||notes.has(key))
    return {rows:[]};
   notes.set(key,{id:41,kind,body,fingerprint});
   if(!loseEvent)events.set(key,91);
   if(fail){fail=false;throw Error('committed, response lost');}
   return {rows:[{id:41,receiptId:91}]};
  }
  throw Error('unexpected SQL');
 }}};
}
test('non-GitHub cloud effect is keyed, persisted with event and read back once',async()=>{
 const h=harness();
 const first=await executeCloudNote({db:h.db,request:request()});
 assert.equal(first.status,'completed');
 assert.equal(first.reused,false);
 assert.equal(first.noteId,41);
 assert.equal(first.receiptId,91);
 const second=await executeCloudNote({db:h.db,request:request()});
 assert.equal(second.status,'completed');
 assert.equal(second.reused,true);
 assert.equal(h.notes.size,1);
 assert.equal(h.events.size,1);
 assert.equal(h.calls.filter(x=>x.sql.includes('INSERT INTO brain_notes')).length,1);
});
test('lost response reconciles by readback without repeating a cloud effect',async()=>{
 const h=harness({lostAck:true});
 const first=await executeCloudNote({db:h.db,request:request()});
 assert.equal(first.status,'completed');
 assert.equal(first.reused,true);
 assert.equal((await executeCloudNote({db:h.db,request:request()})).reused,true);
 assert.equal(h.notes.size,1);
 assert.equal(h.calls.filter(x=>x.sql.includes('INSERT INTO brain_notes')).length,1);
});
test('changed key payload and stopped or absent authority cannot write',async()=>{
 const h=harness();await executeCloudNote({db:h.db,request:request()});
 const conflict=await executeCloudNote({db:h.db,request:{...request(),body:'altered'}});
 assert.equal(conflict.reason,'idempotency-conflict');
 for(const options of [{paused:true},{allowed:false},{loseEvent:true}]){
  const x=harness(options);
  const result=await executeCloudNote({db:x.db,request:request()});
  assert.notEqual(result.status,'completed');
 }
 for(const bad of [{...request(),expectedStopVersion:4},
  {...request(),kind:'billing'}, {...request(),body:''},
  {...request(),maxPaidCents:1}]){
  const x=harness();
  assert.notEqual((await executeCloudNote({db:x.db,request:bad})).status,'completed');
  assert.equal(x.notes.size,0);
 }
});
test('route is owner-gated and migration binds keyed notes to immutable receipts',async()=>{
 const [api,migration]=await Promise.all([
  readFile(new URL('../cloud/hatchable/api/brain/cloud-action.js',import.meta.url),'utf8'),
  readFile(new URL('../cloud/hatchable/migrations/0019_cloud_actions.sql',import.meta.url),'utf8')
 ]);
 assert.match(api,/access='admin'/);
 assert.match(api,/req\.member\?\.handle!=='michaeljwilliams0123'/);
 assert.match(api,/executeCloudNote/);
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS brain_notes_action_key/);
 assert.match(migration,/cloud action note immutable/);
});
