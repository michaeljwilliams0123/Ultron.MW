import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker,{forwardMessage} from '../edge-proxy/src/index.js';

globalThis.crypto ??= webcrypto;
const encoder=new TextEncoder();
const INGRESS_KEY='uuam-staging-ingress-'.padEnd(48,'x');
const DELIVERY_KEY='uuam-staging-delivery-'.padEnd(48,'y');
const NOW=Date.now();
const EVENT={
  schema:'ultron.uuam.ingress.v1',
  source:'ultron-staging',
  deliveryId:'delivery-001',
  taskKey:'task-uuam-001',
  operationDigest:'a'.repeat(64),
  githubIdempotencyKey:'ultron-task-uuam-001',
  nonce:'c'.repeat(32),
  payload:{objective:'read-only-staging-canary'}
};
const hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
async function signedHeaders(raw,ts=Math.floor(Date.now()/1000),key=INGRESS_KEY){
  const cryptoKey=await crypto.subtle.importKey('raw',encoder.encode(key),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',cryptoKey,
    encoder.encode(ts+'.'+raw));
  return {'content-type':'application/json',
    'x-ultron-timestamp':String(ts),'x-ultron-signature':'sha256='+hex(sig)};
}
const queueSpy=()=>{
  const messages=[];
  return {messages,async send(message){messages.push(message);}};
};
function env(overrides={}){
  return {ENVIRONMENT:'staging',REPOSITORY:'michaeljwilliams0123/Ultron.MW',
    HATCHABLE_CORE_ORIGIN:'https://ultron-mw-cloud.hatchable.site',
    HATCHABLE_INBOX_ENABLED:'true',
    ULTRON_INGRESS_HMAC_KEY:INGRESS_KEY,
    HATCHABLE_DELIVERY_HMAC_KEY:DELIVERY_KEY,
    ULTRON_EVENT_QUEUE:queueSpy(),ULTRON_DEAD_LETTER_QUEUE:queueSpy(),...overrides};
}
async function ingress(environment,body=JSON.stringify(EVENT),options={}){
  const headers=options.headers??await signedHeaders(body);
  return worker.fetch(new Request('https://ultron-mw-edge-staging.example/ingress',
    {method:'POST',headers,body}),environment,{});
}
function delivery(messageBody){
  const state={ack:0,retry:0};
  return {message:{id:'q-message-001',body:messageBody,
    attempts:1,ack(){state.ack++},retry(){state.retry++}},
    state};
}
async function staged(){
  const e=env();
  const r=await ingress(e);
  assert.equal(r.status,202);
  assert.equal(e.ULTRON_EVENT_QUEUE.messages.length,1);
  return {e,body:e.ULTRON_EVENT_QUEUE.messages[0]};
}

test('ingress denies requests without exact HMAC',async()=>{
  const e=env();
  const response=await ingress(e,JSON.stringify(EVENT),{headers:{
    'content-type':'application/json','x-ultron-timestamp':String(Math.floor(NOW/1000)),
    'x-ultron-signature':'sha256='+'0'.repeat(64)}});
  assert.equal(response.status,401);
  assert.equal(e.ULTRON_EVENT_QUEUE.messages.length,0);
});
test('old timestamp is rejected before queue staging',async()=>{
  const raw=JSON.stringify(EVENT),e=env();
  const response=await ingress(e,raw,{headers:await signedHeaders(raw,
    Math.floor(Date.now()/1000)-600)});
  assert.equal(response.status,401);
  assert.equal(e.ULTRON_EVENT_QUEUE.messages.length,0);
});
test('missing config and missing receiver acceptance prevent admission',async()=>{
  const r1=await ingress(env({ULTRON_INGRESS_HMAC_KEY:undefined}));
  assert.equal(r1.status,503);
  const r2=await ingress(env({HATCHABLE_INBOX_ENABLED:'false'}));
  assert.equal(r2.status,503);
});
test('malformed signed event cannot reach the queue',async()=>{
  const raw=JSON.stringify({...EVENT,operationDigest:'not-a-digest'});
  const e=env(),response=await ingress(e,raw);
  assert.equal(response.status,400);
  assert.equal(e.ULTRON_EVENT_QUEUE.messages.length,0);
});
test('signed admission persists original exact request bytes in queue envelope',async()=>{
  const {e,body}=await staged();
  assert.equal(body.deliveryId,EVENT.deliveryId);
  assert.equal(body.rawBody,JSON.stringify(EVENT));
  assert.equal(body.operationDigest,EVENT.operationDigest);
  const checksum=hex(await crypto.subtle.digest('SHA-256',
    encoder.encode(JSON.stringify(EVENT))));
  assert.equal(body.rawSha256,checksum);
  assert.equal(e.ULTRON_EVENT_QUEUE.messages.length,1);
});
test('201/200 receipt acknowledgments require delivery and digest readback',async()=>{
  const {e,body}=await staged();
  const {message,state}=delivery(body);
  let forwarded;
  const fetchStub=async(url,init)=>{
    forwarded={url,init};
    return new Response(JSON.stringify({status:'persisted',
      deliveryId:body.deliveryId,payloadSha256:body.rawSha256}),{
      status:201,headers:{'content-type':'application/json'}});
  };
  await forwardMessage(message,e,fetchStub);
  assert.equal(state.ack,1);assert.equal(state.retry,0);
  assert.equal(forwarded.url,'https://ultron-mw-cloud.hatchable.site/api/brain/uuam-inbox');
  const key=await crypto.subtle.importKey('raw',encoder.encode(DELIVERY_KEY),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const timestamp=forwarded.init.headers['X-Ultron-Timestamp'];
  const signature=forwarded.init.headers['X-Ultron-Signature'].slice(7);
  assert.equal(await crypto.subtle.verify('HMAC',key,
    Uint8Array.from(signature.match(/../g).map(x=>parseInt(x,16))),
    encoder.encode(timestamp+'.'+forwarded.init.body)),true);
});
test('200 response without exact durable receipt is retried, never acknowledged',async()=>{
  const {e,body}=await staged();
  const {message,state}=delivery(body);
  await forwardMessage(message,e,async()=>new Response(JSON.stringify({
    status:'ok',deliveryId:body.deliveryId,payloadSha256:body.rawSha256
  }),{status:200,headers:{'content-type':'application/json'}}));
  assert.equal(state.ack,0);assert.equal(state.retry,1);
});
test('503 network partition is retried and never marked delivered',async()=>{
  const {e,body}=await staged();
  const {message,state}=delivery(body);
  await forwardMessage(message,e,async()=>new Response('unavailable',{status:503}));
  assert.equal(state.ack,0);assert.equal(state.retry,1);
  assert.equal(e.ULTRON_DEAD_LETTER_QUEUE.messages.length,0);
});
test('403 quarantines original event before acknowledging source message',async()=>{
  const {e,body}=await staged();
  const {message,state}=delivery(body);
  await forwardMessage(message,e,async()=>new Response('no',{status:403}));
  assert.equal(state.ack,1);assert.equal(state.retry,0);
  assert.equal(e.ULTRON_DEAD_LETTER_QUEUE.messages.length,1);
  assert.equal(e.ULTRON_DEAD_LETTER_QUEUE.messages[0].event.deliveryId,
    body.deliveryId);
});
test('failed DLQ write retries source message, no silent loss',async()=>{
  const {e,body}=await staged();
  e.ULTRON_DEAD_LETTER_QUEUE.send=async()=>{
    throw Error('DLQ unavailable');
  };
  const {message,state}=delivery(body);
  await forwardMessage(message,e,async()=>new Response('bad',{status:422}));
  assert.equal(state.ack,0);assert.equal(state.retry,1);
});
test('missing forwarding key never contacts Hatchable',async()=>{
  const {e,body}=await staged();
  e.HATCHABLE_DELIVERY_HMAC_KEY=undefined;
  const {message,state}=delivery(body);
  await forwardMessage(message,e,async()=>{throw Error('must not fetch');});
  assert.equal(state.ack,0);assert.equal(state.retry,1);
});
test('non-ingress methods and unknown paths are not accepted',async()=>{
  const e=env();
  const health=await worker.fetch(new Request('https://edge.test/healthz'),e,{});
  assert.equal(health.status,200);
  const other=await worker.fetch(new Request('https://edge.test/'),e,{});
  assert.equal(other.status,404);
  const method=await worker.fetch(new Request('https://edge.test/ingress'),e,{});
  assert.equal(method.status,405);
});
