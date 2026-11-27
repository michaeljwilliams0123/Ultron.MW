import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/agent-relay/worker.mjs';
import { readFileSync } from 'node:fs';
const key = 'a'.repeat(64), other = 'b'.repeat(64);
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloudflare/agent-relay/schema.sql',import.meta.url),'utf8'));
  const env = { CHATGPT_RELAY_KEY:key, GEMINI_RELAY_KEY:other, RELAY_DB: {
    prepare(sql) { const stmt=db.prepare(sql); return {bind(...args){return {async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}},async first(){return stmt.get(...args)??null},async all(){return {results:stmt.all(...args)}}}}} }
  }};
  return {env,db};
}
let n=0;
function signed(path,method,agent,body='',opts={}) {
  const ts=opts.ts??String(Math.floor(Date.now()/1000)),nonce=opts.nonce??('test-nonce-'+String(++n).padStart(12,'0'));
  const mac=createHmac('sha256',agent==='ChatGPT'?key:other).update([method,path,agent,ts,nonce,body].join('\n')).digest('hex');
  return new Request('https://relay.example'+path,{method,headers:{'x-relay-agent':agent,'x-relay-timestamp':ts,'x-relay-nonce':nonce,'x-relay-signature':mac,'content-type':'application/json'},...(method==='POST'?{body}: {})});
}
const event=JSON.stringify({message_id:'msg-001',recipient:'Gemini',event_type:'coordination',correlation_id:'corr-001'});
test('rejects unauthenticated access without touching storage',async()=>{assert.equal((await worker.fetch(new Request('https://relay.example/__ultron/webhooks/events'),{})).status,401)});
test('authenticated ingress, recipient-scoped read and ack, identical duplicate, conflicting ID',async()=>{
 const {env}=setup(); const call=(p,m,a,b)=>worker.fetch(signed(p,m,a,b),env);
 assert.equal((await call('/__ultron/webhooks/relay','POST','ChatGPT',event)).status,201);
 assert.equal((await call('/__ultron/webhooks/relay','POST','ChatGPT',event)).status,200);
 assert.equal((await call('/__ultron/webhooks/relay','POST','ChatGPT',event.replace('corr-001','corr-002'))).status,409);
 assert.equal((await (await call('/__ultron/webhooks/events','GET','ChatGPT')).json()).events.length,0);
 assert.equal((await (await call('/__ultron/webhooks/events','GET','Gemini')).json()).events.length,1);
 assert.equal((await call('/__ultron/webhooks/ack','POST','ChatGPT',JSON.stringify({message_id:'msg-001'}))).status,404);
 assert.equal((await call('/__ultron/webhooks/ack','POST','Gemini',JSON.stringify({message_id:'msg-001'}))).status,200);
 assert.equal((await (await call('/__ultron/webhooks/events','GET','Gemini')).json()).events[0].status,'ACKNOWLEDGED');
});
test('rejects replay and expired signature',async()=>{const {env}=setup();const p='/__ultron/webhooks/events';let opt={nonce:'unique-nonce-123456789'};assert.equal((await worker.fetch(signed(p,'GET','Gemini','',opt),env)).status,200);assert.equal((await worker.fetch(signed(p,'GET','Gemini','',opt),env)).status,409);assert.equal((await worker.fetch(signed(p,'GET','Gemini','',{ts:'1'}),env)).status,401)});
test('rejects sender spoof and private payload',async()=>{const {env}=setup();for(const extra of [{sender:'Gemini'},{payload:{secret:'x'}}]){assert.equal((await worker.fetch(signed('/__ultron/webhooks/relay','POST','ChatGPT',JSON.stringify({...JSON.parse(event),...extra})),env)).status,400)}});
test('denies non-relay routes without upstream fetch',async()=>{const {env}=setup();assert.equal((await worker.fetch(signed('/api/edge/ledger','GET','ChatGPT'),env)).status,404);assert.equal((await worker.fetch(signed('/api/brain/release-proof','GET','ChatGPT'),env)).status,404)});
test('signed query is recipient scoped and tampering fails authentication',async()=>{
 const {env}=setup(); const p='/__ultron/webhooks/events?recipient=ChatGPT';
 assert.equal((await worker.fetch(signed(p,'GET','Gemini'),env)).status,403);
 const req=signed('/__ultron/webhooks/events?status=RECEIVED','GET','Gemini');
 const tampered=new Request('https://relay.example/__ultron/webhooks/events?status=ACKNOWLEDGED',{headers:req.headers});
 assert.equal((await worker.fetch(tampered,env)).status,401);
});
test('shared credentials and oversized request fail closed',async()=>{
 const {env}=setup(); env.GEMINI_RELAY_KEY=env.CHATGPT_RELAY_KEY;
 assert.equal((await worker.fetch(signed('/__ultron/webhooks/events','GET','ChatGPT'),env)).status,401);
 env.GEMINI_RELAY_KEY=other;
 assert.equal((await worker.fetch(signed('/__ultron/webhooks/relay','POST','ChatGPT','x'.repeat(4097)),env)).status,413);
});
