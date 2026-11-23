import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../cloud/hatchable/api/brain/council-deep-callback.js',import.meta.url),'utf8');
const marker="import {db,webhooks,config,events} from 'hatchable';";
assert.ok(source.startsWith(marker));
const testable=source.replace(marker,'const {db,webhooks,config,events}=globalThis.__callbackTestSdk;');
let importCounter=0;

async function probe({storedDigest=null,lastDigest=null,taskStatus='external',payloadDigest='a'.repeat(64)}={}){
 const updates=[],published=[];
 globalThis.__callbackTestSdk={
  config:{get:async()=>'x'.repeat(64)},
  webhooks:{verifyHmac:async()=>true},
  events:{publish:async(...args)=>published.push(args)},
  db:{query:async sql=>{
   if(sql.includes('SELECT t.id,t.task_key,t.status,t.last_result'))return {rows:[{
    id:5,task_key:'test-callback',status:taskStatus,last_result:lastDigest?{
     reasoningBridge:{requestDigest:lastDigest}}:{},job_id:2,message_id:3,
    request_digest:storedDigest,room_key:'owner-main'
   }]};
   updates.push(sql);
   return {rows:[{task_id:5,job_id:2,inserted_message_id:4}]};
  }}
 };
 const handler=(await import('data:text/javascript;base64,'+Buffer.from(testable).toString('base64')+'#'+(++importCounter))).default;
 const req={headers:{'x-ultron-signature-256':'sha256='+'b'.repeat(64)},
  rawBody:'{"sample":"signed"}',body:{schema:'ultron.council-deep-callback.v1',
   taskId:'5',roomKey:'owner-main',requestDigest:payloadDigest,
   results:{Builder:{source:'model',provider:'unit-test',modelId:'fake',verdict:'proceed'}}}};
 const response={statusCode:0,body:null,setHeader(){return this;},
  status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
 await handler(req,response);
 return {status:response.statusCode,body:response.body,updates:updates.length,published:published.length};
}
test('signed callback MUST reject missing stored request digest before ANY mutation',async()=>{
 const r=await probe();
 assert.equal(r.status,409);
 assert.equal(r.body.error,'request-digest-unbound');
 assert.equal(r.updates,0);
 assert.equal(r.published,0);
});
test('signed callback rejects foreign digest even if stored digest exists',async()=>{
 const r=await probe({storedDigest:'c'.repeat(64)});
 assert.equal(r.status,409);assert.equal(r.body.error,'request-digest-mismatch');
 assert.equal(r.updates,0);
});
test('legacy persisted result digest remains a valid bound fallback',async()=>{
 const r=await probe({lastDigest:'a'.repeat(64)});
 assert.equal(r.status,200);
});

test('already-completed signed callback replays do not mutate or republish',async()=>{
 const r=await probe({storedDigest:'a'.repeat(64),lastDigest:'a'.repeat(64),taskStatus:'done'});
 assert.equal(r.status,200);
 assert.equal(r.body.reused,true);
 assert.equal(r.updates,0);
 assert.equal(r.published,0);
});
test('canceled task cannot be revived by a late signed callback',async()=>{
 const r=await probe({storedDigest:'a'.repeat(64),taskStatus:'canceled'});
 assert.equal(r.status,409);
 assert.equal(r.body.error,'callback-task-terminal');
 assert.equal(r.updates,0);
 assert.equal(r.published,0);
});
