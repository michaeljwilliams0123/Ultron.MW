import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{access,methods} from '../cloud/hatchable/api/brain/cloudflare-edge-health.js';

const owner={member:{handle:'michaeljwilliams0123'}};
const response=()=>{
 let code=200,payload=null;
 return {
  setHeader(name,value){assert.equal(name,'Cache-Control');assert.equal(value,'private, no-store');},
  status(value){code=value;return this;},
  json(value){payload=value;return this;},
  get code(){return code;},get payload(){return payload;}
 };
};

test('Cloudflare health is owner-only GET and never authorizes a provider write',async()=>{
 assert.equal(access,'admin');
 assert.deepEqual(methods,['GET']);
 const oldFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{
  calls.push({url,opts});
  return new Response(JSON.stringify({service:'uuam-edge-staging',status:'available',accepting:false}),{status:200});
 };
 try{
  const res=response();
  await handler(owner,res);
  assert.equal(res.code,200);
  assert.equal(res.payload.state,'observed');
  assert.equal(res.payload.ingressAccepting,false);
  assert.equal(res.payload.executionAuthorized,false);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/^https:\/\/ultron-mw-edge-staging\.mahoraga-mjw0123\.workers\.dev\/healthz$/);
  assert.equal(calls[0].opts.method,'GET');
 }finally{globalThis.fetch=oldFetch;}
});

test('wrong collaborator is denied before any Cloudflare fetch',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('must not fetch')};
 try{
  const res=response();
  await handler({member:{handle:'untrusted'}},res);
  assert.equal(res.code,403);
  assert.equal(res.payload.error,'owner-identity-required');
 }finally{globalThis.fetch=oldFetch;}
});

test('incorrect health service fails closed and does not claim acceptance',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({service:'unexpected',status:'available',accepting:true}),{status:200});
 try{
  const res=response();
  await handler(owner,res);
  assert.equal(res.code,502);
  assert.equal(res.payload.state,'invalid-readback');
  assert.equal(res.payload.executionAuthorized,false);
 }finally{globalThis.fetch=oldFetch;}
});

test('Cloudflare outage returns unavailable without emitting effects',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('offline')};
 try{
  const res=response();
  await handler(owner,res);
  assert.equal(res.code,503);
  assert.equal(res.payload.state,'unavailable');
  assert.equal(res.payload.executionAuthorized,false);
 }finally{globalThis.fetch=oldFetch;}
});

test('health probe sets a bounded request timeout without exposing authority',async()=>{
 const oldFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
 let delayMs=null,signals=0;
 AbortSignal.timeout=ms=>{
  delayMs=ms;
  const controller=new AbortController();
  queueMicrotask(()=>controller.abort());
  return controller.signal;
 };
 globalThis.fetch=async(_url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal,'upstream GET must have an abort signal');
  signals++;
  return await new Promise((_resolve,reject)=>{
   const onAbort=()=>reject(new Error('upstream deadline exceeded'));
   if(options.signal.aborted)onAbort();
   else options.signal.addEventListener('abort',onAbort,{once:true});
  });
 };
 try{
  const res=response();
  await handler(owner,res);
  assert.equal(res.code,503);
  assert.equal(res.payload.state,'unavailable');
  assert.equal(res.payload.executionAuthorized,false);
  assert.equal(signals,1);
  assert.ok(delayMs>0&&delayMs<=5000,'the timeout must be positive and no more than 5s');
 }finally{
  globalThis.fetch=oldFetch;
  AbortSignal.timeout=originalTimeout;
 }
});
