import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/agent-relay/worker.mjs';
import { readFileSync } from 'node:fs';
const pairs=Object.fromEntries(['ChatGPT','Gemini'].map(a=>[a,generateKeyPairSync('ec',{namedCurve:'prime256v1'})]));
const keys=Object.fromEntries(Object.entries(pairs).map(([a,p])=>[a,p.publicKey.export({format:'jwk'})]));
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../cloudflare/agent-relay/schema.sql',import.meta.url),'utf8'));
 const env={AGENT_PUBLIC_KEYS:JSON.stringify(keys),RELAY_DB:{prepare(sql){const s=db.prepare(sql);return {bind(...args){return {async run(){return {meta:{changes:Number(s.run(...args).changes)}}},async first(){return s.get(...args)??null},async all(){return {results:s.all(...args)}}}}}}}};
 return {env,db};
}
let n=0;
function signed(path,method,agent,body='',opts={}){
 const ts=opts.ts??String(Date.now()),nonce=opts.nonce??('test-nonce-'+String(++n).padStart(12,'0'));
 const digest=createHash('sha256').update(body).digest('hex');
 const canonical=['ULTRON-WEBHOOK-v2',method,path,agent,ts,nonce,digest].join('\n');
 const signature=sign('sha256',Buffer.from(canonical),{key:pairs[opts.signer??agent].privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 return new Request('https://relay.example'+path,{method,headers:{'x-ultron-agent':agent,'x-ultron-timestamp':ts,'x-ultron-nonce':nonce,'x-ultron-signature':signature,'content-type':'application/json'},...(method==='POST'?{body}:{})});
}
const event={message_id:'msg-001',recipient:'Gemini',event_type:'coordination',correlation_id:'corr-001'};
const prefix='/__ultron/webhooks/';
const call=(env,route,agent,body,opts)=>worker.fetch(signed(prefix+route,body===undefined?'GET':'POST',agent,body===undefined?'':JSON.stringify(body),opts),env);
test('unsigned, wrong key, and unknown routes denied',async()=>{const {env}=setup();assert.equal((await worker.fetch(new Request('https://relay.example'+prefix+'events'),env)).status,401);assert.equal((await call(env,'events','ChatGPT',undefined,{signer:'Gemini'})).status,401);assert.equal((await worker.fetch(signed('/api/edge/ledger','GET','ChatGPT'),env)).status,404);assert.equal((await worker.fetch(signed('/api/brain/release-proof','GET','ChatGPT'),env)).status,404)});
test('per-agent identity must use distinct public keys, even with different JWK metadata',async()=>{const {env}=setup();env.AGENT_PUBLIC_KEYS=JSON.stringify({ChatGPT:keys.ChatGPT,Gemini:{...keys.ChatGPT,kid:'different'}});assert.equal((await call(env,'events','ChatGPT')).status,401)});
test('signed query, timestamp and nonce are bound',async()=>{const {env}=setup();assert.equal((await call(env,'events?recipient=ChatGPT','Gemini')).status,403);const req=signed(prefix+'events?status=RECEIVED','GET','Gemini');assert.equal((await worker.fetch(new Request('https://relay.example'+prefix+'events?status=ACKNOWLEDGED',{headers:req.headers}),env)).status,401);const opt={nonce:'unique-nonce-123456789'};assert.equal((await call(env,'events','Gemini',undefined,opt)).status,200);assert.equal((await call(env,'events','Gemini',undefined,opt)).status,409);assert.equal((await call(env,'events','Gemini',undefined,{ts:String(Date.now()-301000)})).status,401);assert.equal((await call(env,'events','Gemini',undefined,{ts:String(Date.now()+61000)})).status,401)});
test('opaque messages, sender binding, duplicate conflict and scoped inbox',async()=>{const {env}=setup();assert.equal((await call(env,'relay','ChatGPT',event)).status,201);assert.equal((await call(env,'relay','ChatGPT',event)).status,200);assert.equal((await call(env,'relay','ChatGPT',{...event,correlation_id:'corr-002'})).status,409);for(const extra of [{sender:'Gemini'},{payload:{private:'x'}}])assert.equal((await call(env,'relay','ChatGPT',{...event,...extra})).status,400);assert.equal((await (await call(env,'events','ChatGPT')).json()).events.length,0);assert.equal((await (await call(env,'events','Gemini')).json()).events.length,1)});
test('atomic lease, expiry, stale fence, wrong recipient and idempotent fenced ack',async()=>{const {env,db}=setup();await call(env,'relay','ChatGPT',event);const msg={message_id:event.message_id};assert.equal((await call(env,'claim','ChatGPT',msg)).status,404);assert.equal((await call(env,'ack','Gemini',msg)).status,400);const [a,b]=await Promise.all([call(env,'claim','Gemini',msg),call(env,'claim','Gemini',msg)]);assert.deepEqual([a.status,b.status].sort(),[200,409]);const first=await (a.ok?a:b).json();assert.equal(first.fencing_generation,1);db.prepare('UPDATE agent_relay_v2_events SET lease_expires_at=? WHERE message_id=?').run(Date.now()-1000,event.message_id);const old={...msg,lease_token:first.lease_token,fencing_generation:first.fencing_generation};assert.equal((await call(env,'ack','Gemini',old)).status,409);const second=await (await call(env,'claim','Gemini',msg)).json();assert.equal(second.fencing_generation,2);assert.equal((await call(env,'ack','Gemini',old)).status,409);const current={...msg,lease_token:second.lease_token,fencing_generation:second.fencing_generation};assert.equal((await call(env,'ack','ChatGPT',current)).status,404);assert.equal((await call(env,'ack','Gemini',current)).status,200);assert.equal((await call(env,'ack','Gemini',current)).status,200);assert.equal((await call(env,'ack','Gemini',old)).status,409)});
test('invalid TTL and oversized request rejected',async()=>{const {env}=setup();await call(env,'relay','ChatGPT',event);for(const ttl_ms of ['60000',null,0,300001])assert.equal((await call(env,'claim','Gemini',{message_id:event.message_id,ttl_ms})).status,400);assert.equal((await worker.fetch(signed(prefix+'relay','POST','ChatGPT','x'.repeat(4097)),env)).status,413)});
test('nonce cleanup is bounded and preserves every unexpired replay fence',async()=>{
 const {env,db}=setup();
 const insert=db.prepare('INSERT INTO agent_relay_v2_nonces(agent,nonce,expires_at) VALUES(?,?,?)');
 const now=Date.now();
 for(let i=0;i<101;i++)insert.run('Gemini','expired-nonce-'+i,now-1000);
 insert.run('Gemini','still-active-nonce',now+360000);
 assert.equal((await call(env,'events','Gemini')).status,200);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_relay_v2_nonces WHERE expires_at < ?').get(now).n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_relay_v2_nonces WHERE nonce=?').get('still-active-nonce').n,1);
 assert.equal((await call(env,'events','Gemini',undefined,{nonce:'still-active-nonce'})).status,409);
 assert.equal((await call(env,'events','Gemini')).status,200);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_relay_v2_nonces WHERE expires_at < ?').get(now).n,0);
});
test('lease expiration during storage delay is rejected at the atomic update',async()=>{
 const {env,db}=setup();await call(env,'relay','ChatGPT',event);
 const lease=await (await call(env,'claim','Gemini',{message_id:event.message_id})).json();
 const original=env.RELAY_DB.prepare;
 env.RELAY_DB.prepare=function(sql){
  const stmt=original(sql);
  if(!sql.startsWith("UPDATE agent_relay_v2_events SET status='ACKNOWLEDGED'"))return stmt;
  return {bind(...args){const bound=stmt.bind(...args);return {...bound,async run(){
   await new Promise(resolve=>setTimeout(resolve,120));
   db.prepare("UPDATE agent_relay_v2_events SET lease_expires_at=CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)-5 WHERE message_id=?").run(event.message_id);
   return bound.run();
  }}}};
 };
 const result=await call(env,'ack','Gemini',{message_id:event.message_id,lease_token:lease.lease_token,fencing_generation:lease.fencing_generation});
 assert.equal(result.status,409);
 assert.equal(db.prepare('SELECT status FROM agent_relay_v2_events WHERE message_id=?').get(event.message_id).status,'CLAIMED');
});
