import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresCapabilityAttemptStore} from '../src/capability-attempt-store.mjs';

function dbFixture(){
 const rows=new Map();
 return {rows,async query(sql,args){
   if(sql.includes('INSERT INTO capability_attempts')){
     if(rows.has(args[0]))return {rows:[]};
     rows.set(args[0],{fingerprint:args[1],status:args[2],
       receipt:JSON.parse(args[3])});
     return {rows:[{attempt_id:args[0],fingerprint:args[1],
       receipt:JSON.parse(args[3])}]};
   }
   if(sql.includes('SELECT fingerprint,receipt')){
     const r=rows.get(args[0]);
     return {rows:r?[{fingerprint:r.fingerprint,receipt:r.receipt}]:[]};
   }
   if(sql.includes('UPDATE capability_attempts')){
     const r=rows.get(args[0]);
     if(!r||r.fingerprint!==args[1]||r.status!==args[2])
       return {rows:[]};
     rows.set(args[0],{fingerprint:r.fingerprint,status:args[3],
       receipt:JSON.parse(args[4])});
     return {rows:[{attempt_id:args[0]}]};
   }
   if(sql.includes('DELETE FROM capability_attempts')){
     const r=rows.get(args[0]);
     if(!r||r.fingerprint!==args[1]||r.status!=='approval-pending')
       return {rows:[]};
     rows.delete(args[0]);return {rows:[{attempt_id:args[0]}]};
   }
   throw Error('Unexpected statement: '+sql.slice(0,50));
 }};
}
test('Postgres CAS adapter preserves sent receipt across independent workers',async()=>{
 const db=dbFixture(),a=createPostgresCapabilityAttemptStore({db}),
   b=createPostgresCapabilityAttemptStore({db});
 const id='github-owner:write:durable01',fingerprint='a'.repeat(64);
 const pending={status:'approval-pending',bindingId:'github-owner'};
 const first=await a.claim({id,fingerprint,receipt:pending});
 const replay=await b.claim({id,fingerprint,receipt:pending});
 assert.equal(first.claimed,true);
 assert.equal(replay.claimed,false);
 await a.advance({id,fingerprint,expectedStatus:'approval-pending',
   receipt:{status:'reconcile-required',bindingId:'github-owner'}});
 await assert.rejects(b.release({id,fingerprint}),/releasable/);
 const recovered=await b.claim({id,fingerprint,receipt:pending});
 assert.equal(recovered.receipt.status,'reconcile-required');
 await b.advance({id,fingerprint,expectedStatus:'reconcile-required',
   receipt:{status:'completed',bindingId:'github-owner'}});
 assert.equal((await a.claim({id,fingerprint,receipt:pending})).receipt.status,'completed');
 await assert.rejects(a.claim({id,fingerprint:'b'.repeat(64),receipt:pending})
   .then(value=>{if(value.fingerprint!=='b'.repeat(64))throw Error('conflict');}),/conflict/);
});
test('only an undispatched approval can be safely released',async()=>{
 const db=dbFixture(),store=createPostgresCapabilityAttemptStore({db});
 const id='github-owner:write:release01',fingerprint='b'.repeat(64);
 const pending={status:'approval-pending',bindingId:'github-owner'};
 await store.claim({id,fingerprint,receipt:pending});
 assert.equal(await store.release({id,fingerprint}),true);
 assert.equal((await store.claim({id,fingerprint,receipt:pending})).claimed,true);
 await assert.rejects(store.advance({id,fingerprint:'c'.repeat(64),
   expectedStatus:'approval-pending',receipt:{status:'reconcile-required'}}),/conflict/);
 await assert.rejects(store.advance({id,fingerprint,
   expectedStatus:'completed',receipt:{status:'approval-pending'}}),/transition/);
});
