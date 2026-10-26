import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function endpoint({secret='secret-with-adequate-entropy-1234567890',response=null}={}){
 const source=await readFile(new URL('../cloud/hatchable/api/brain/events.js',import.meta.url),'utf8');
 const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const platform=url(`export const db={}; export const scheduler={};
 export const config={get:async()=>globalThis.__eventEndpoint.secret};`);
 const signed=url(`export async function verifySignedEvent({raw,secret}){
 if(raw!=='trusted')throw Error('event-signature-invalid');
 return {verified:true,source:'github-bridge'};
 }
 export async function admitSignedEvent(){
  return globalThis.__eventEndpoint.response??{ok:true,created:true,taskId:19};
 }`);
 globalThis.__eventEndpoint={secret,response};
 return import(url(source.replace("from 'hatchable'","from '"+platform+"'")
  .replace("from 'lib/signed-event-inbox.js'","from '"+signed+"'"))+'#'+Math.random());
}
function response(){
 return {code:200,status(n){this.code=n;return this;},
  json(body){return {status:this.code,body};}};
}
test('signed event endpoint has public edge access but never executes unverified events',async()=>{
 const m=await endpoint();assert.equal(m.access,'public');
 assert.deepEqual(m.methods,['POST']);
 delete globalThis.__eventEndpoint;
});
test('unconfigured signing authority prevents public event admission',async()=>{
 const m=await endpoint({secret:null});
 const r=await m.default({body:{raw:'trusted'}},response());
 assert.equal(r.status,503);assert.equal(r.body.error,'event-bridge-unconfigured');
 delete globalThis.__eventEndpoint;
});
test('invalid signature is rejected; valid event only queues durable objective',async()=>{
 const m=await endpoint();
 const denied=await m.default({body:{raw:'malicious',timestamp:'123',signature:'fake'}},response());
 assert.equal(denied.status,403);
 const admitted=await m.default({body:{raw:'trusted'}},response());
 assert.equal(admitted.status,202);
 assert.equal(admitted.body.status,'admitted-not-executed');
 assert.equal(admitted.body.taskId,19);
 delete globalThis.__eventEndpoint;
});
test('duplicate and queue-full event admissions expose a non-executable outcome',async()=>{
 const duplicate=await endpoint({response:{ok:true,created:false,reason:'duplicate-delivery'}});
 const a=await duplicate.default({body:{raw:'trusted'}},response());
 assert.equal(a.status,200);assert.equal(a.body.status,'duplicate-delivery');
 const full=await endpoint({response:{ok:false,error:'queue-full'}});
 const b=await full.default({body:{raw:'trusted'}},response());
 assert.equal(b.status,429);
 delete globalThis.__eventEndpoint;
});
