import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,randomBytes,createHmac} from 'node:crypto';
import {signOfflineTask,openOfflineSyncQueue} from '../src/core/offline-sync-queue.js';
const NOW=Date.parse('2026-11-12T23:00:00Z');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const {privateKey:foreignPrivate}=generateKeyPairSync('ed25519');
const integrityKey=randomBytes(32);
const digest='a'.repeat(64);
let seq=0;
function signed(extra={}){
 const id='evt-offline-'+String(++seq).padStart(8,'0');
 return signOfflineTask({id,idempotencyKey:'ultron-offline-'+id,
  actor:'mw-primary',operation:'repo.inspect',effect:'read',
  payload:{repository:'michaeljwilliams0123/Ultron.MW'},
  createdAt:NOW,expiresAt:NOW+3600000,privateKey,...extra});
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'ultron-offline-'));
 const path=join(root,'events.json');
 const open=(extra={})=>openOfflineSyncQueue({path,integrityKey,
  trustedKeys:{'mw-primary':publicKey},
  readOperations:['repo.inspect','council.review'],
  stagedWriteOperations:['github.branch.create'],
  clock:()=>NOW,maxAttempts:3,baseDelayMs:1000,...extra});
 return {path,open,remove:()=>rm(root,{recursive:true,force:true})};
}
test('signed read queues durably and only a verified response completes it',async()=>{
 const f=await fixture();
 try{
  let q=await f.open(),item=signed();
  assert.equal((await q.enqueue(item)).status,'queued');
  await q.close();q=await f.open();
  const observed=[];
  assert.equal((await q.drain(async e=>{
   observed.push(e.task.id);return {verified:true,receiptDigest:digest};
  })).delivered,1);
  assert.deepEqual(observed,[item.task.id]);
  assert.equal((await q.list())[0].status,'delivered');
  await q.close();q=await f.open();
  assert.equal((await q.list())[0].status,'delivered');
  await q.close();
 }finally{await f.remove();}
});
test('identical replay is idempotent but payload and nonce conflict fail closed',async()=>{
 const f=await fixture();
 try{
  const q=await f.open(),one=signed();
  await q.enqueue(one);
  assert.equal((await q.enqueue(one)).status,'queued');
  await assert.rejects(q.enqueue(signed({id:one.task.id})),/conflict/);
  await assert.rejects(q.enqueue(signed({idempotencyKey:one.task.idempotencyKey})),/conflict/);
  assert.equal((await q.list()).length,1);await q.close();
 }finally{await f.remove();}
});
test('foreign Ed25519 signer and altered signed payload are rejected',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();
  await assert.rejects(q.enqueue(signed({privateKey:foreignPrivate})),/signature/);
  const tampered=structuredClone(signed());
  tampered.task.payload.repository='attacker/evil';
  await assert.rejects(q.enqueue(tampered),/signature/);
  const unknown=signed({actor:'unknown-agent'});
  await assert.rejects(q.enqueue(unknown),/actor/);
  await q.close();
 }finally{await f.remove();}
});
test('write operations may be staged but never executed from this queue',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();
  await q.enqueue(signed({effect:'write',operation:'github.branch.create'}));
  let invoked=0;
  assert.equal((await q.drain(async()=>{invoked++;return {verified:true,receiptDigest:digest};})).attempted,0);
  assert.equal(invoked,0);
  assert.equal((await q.list())[0].status,'staged-write');
  await q.close();
 }finally{await f.remove();}
});
test('ambiguous outcome never auto-replays and requires independent readback',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());
  assert.equal((await q.drain(async()=>{throw Error('response lost');})).reconcileRequired,1);
  const item=(await q.list())[0];
  assert.equal(item.status,'reconcile-required');
  assert.equal((await q.drain(async()=>{throw Error('should not run');})).attempted,0);
  assert.equal(await q.reconcile(item.id,async()=>({verified:false})),false);
  assert.equal(await q.reconcile(item.id,async e=>({
   verified:true,idempotencyKey:e.task.idempotencyKey,receiptDigest:digest
  })),true);
  assert.equal((await q.list())[0].status,'delivered');
  await q.close();
 }finally{await f.remove();}
});
test('pre-dispatch failures use bounded backoff and dead-letter after maximum',async()=>{
 const f=await fixture();let now=NOW;
 try{
  const q=await f.open({clock:()=>now,maxAttempts:2});
  await q.enqueue(signed());
  const fail=async()=>{const e=Error('offline preflight');e.beforeDispatch=true;throw e;};
  await q.drain(fail);
  assert.equal((await q.list())[0].nextAttemptAt,NOW+1000);
  assert.equal((await q.drain(fail)).attempted,0);
  now+=1000;await q.drain(fail);
  assert.equal((await q.list())[0].status,'dead-letter');
  await q.close();
 }finally{await f.remove();}
});
test('unverified success and offline mode do not dispatch or mark delivered',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());
  assert.equal((await q.drain(async()=>{throw Error('offline');},{online:false})).attempted,0);
  await q.drain(async()=>({success:true}));
  assert.equal((await q.list())[0].status,'reconcile-required');
  await q.close();
 }finally{await f.remove();}
});
test('tampering with authenticated local status is rejected after restart',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());await q.close();
  const saved=JSON.parse(await readFile(f.path,'utf8'));
  const modified=structuredClone(saved);modified.records[0].status='delivered';
  await writeFile(f.path,JSON.stringify(modified));
  await assert.rejects(f.open(),/integrity/);
  await writeFile(f.path,JSON.stringify(saved));
  const resumed=await f.open();await resumed.close();
 }finally{await f.remove();}
});
test('second process cannot acquire live writer lock',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await assert.rejects(f.open(),/locked/);
  await q.close();const resumed=await f.open();await resumed.close();
 }finally{await f.remove();}
});
test('refuses payload secrets and impossible task timestamp',()=>{
 assert.throws(()=>signed({payload:{apiKey:'plain-secret'}}),/secret/);
 assert.throws(()=>signed({createdAt:NOW+7200000}),/time/);
 const {privateKey:rsa}=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>signed({privateKey:rsa}),/Ed25519/);
});
test('failed durable dispatch-claim poisons the process without a remote call',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());
  await rm(f.path);await mkdir(f.path);
  let invoked=0;
  await assert.rejects(q.drain(async()=>{invoked++;}),/EISDIR|directory/);
  assert.equal(invoked,0);
  await assert.rejects(q.list(),/poisoned/);
  await q.close();
 }finally{await f.remove();}
});
test('cannot release lock during an ongoing remote read callback',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());
  let resume,notified;
  const pending=new Promise(resolve=>{resume=resolve;});
  const started=new Promise(resolve=>{notified=resolve;});
  const draining=q.drain(async()=>{
   notified();await pending;return {verified:true,receiptDigest:digest};
  });
  await started;
  await assert.rejects(q.close(),/busy/);
  resume();await draining;await q.close();
 }finally{await f.remove();}
});
test('authenticated interrupted dispatch becomes reconcile-required, never auto-replayed',async()=>{
 const f=await fixture();
 try{
  const q=await f.open();await q.enqueue(signed());await q.close();
  const state=JSON.parse(await readFile(f.path,'utf8'));
  state.records[0].status='dispatching';
  const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':
   x&&typeof x==='object'?'{'+Object.keys(x).sort()
    .map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
  const {mac,...body}=state;
  state.mac=createHmac('sha256',integrityKey).update(canon(body)).digest('hex');
  await writeFile(f.path,JSON.stringify(state));
  const recovered=await f.open();
  assert.equal((await recovered.list())[0].status,'reconcile-required');
  assert.equal((await recovered.drain(async()=>{throw Error('replay');})).attempted,0);
  await recovered.close();
 }finally{await f.remove();}
});

test('sparse arrays and non-JSON array properties are rejected before signing',()=>{
 const sparse=[];sparse[1]='second';
 assert.throws(()=>signed({payload:{targets:sparse}}),/invalid payload|non-JSON/);
 const extra=['first'];extra.secretLabel='must-not-be-silently-ignored';
 assert.throws(()=>signed({payload:{targets:extra}}),/invalid payload|non-JSON/);
 const getter=['first'];
 Object.defineProperty(getter,'0',{enumerable:true,configurable:true,get(){throw Error('getter-executed')}});
 assert.throws(()=>signed({payload:{targets:getter}}),/invalid payload|non-JSON/);
});
