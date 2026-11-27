import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createNativeBrowserSession} from '../src/computer/native-browser-transport.mjs';
import {createNativeBrowserClient} from '../src/computer/native-browser-client.mjs';
import {exchangeNativeRead} from '../browser-extension/ultron-native/port.mjs';
const extensionOrigin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const origin='https://ultron-mw-cloud.hatchable.site';
const task={origin,actorRef:'owner:ultron',operation:'page.inspect',scope:'page.read',maxPaidCents:0,idempotencyKey:'read:extension-test',path:'/browser-write-acceptance.html'};
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:v=>{for(const f of [...listeners])f(v);},count:()=>listeners.size};}
async function fixture(mode='normal'){
 const host=generateKeyPairSync('ed25519'),device=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
 let dispatched=0,posted=0,opened=0,closed=0;
 const publicKey=Buffer.from(await crypto.subtle.exportKey('spki',device.publicKey)).toString('base64');
 const options={hostId:'ultron-local-browser',deviceId:'owner-device',extensionOrigin};
 const client=createNativeBrowserClient({...options,hostPublicKey:await crypto.subtle.importKey('spki',host.publicKey.export({format:'der',type:'spki'}),'Ed25519',true,['verify']),devicePrivateKey:device.privateKey,authorize:async()=>true});
 const session=createNativeBrowserSession({...options,callerOrigin:extensionOrigin,hostPrivateKey:host.privateKey,devicePublicKey:'-----BEGIN PUBLIC KEY-----\n'+publicKey+'\n-----END PUBLIC KEY-----',origin,actorRef:task.actorRef,paths:[task.path],authorize:async()=>true,worker:{execute:async t=>{dispatched++;return {status:'completed',bindingId:'playwright-owner',actorRef:t.actorRef,operation:t.operation,effect:'read',costCents:0,idempotencyKey:t.idempotencyKey,resultDigest:'a'.repeat(64)};}}});
 const onMessage=event(),onDisconnect=event();
 const port={onMessage,onDisconnect,disconnect(){closed++;onDisconnect.emit();},postMessage(m){posted++;if(mode==='lost'){queueMicrotask(()=>onDisconnect.emit());return;}queueMicrotask(async()=>{const result=await session.accept(m);onMessage.emit(mode==='tampered'?{...result,body:{...result.body,status:'held'}}:result);if(mode==='exit-after-receipt')onDisconnect.emit();});}};
 const runtime={connectNative(name){assert.equal(name,'com.ultron.browser');opened++;if(mode==='missing')throw Error('missing');queueMicrotask(()=>{if(mode==='before')onDisconnect.emit();else if(mode!=='silent')onMessage.emit(session.challenge);});return port;}};
 return {client,runtime,counts:()=>({dispatched,posted,opened,closed,listeners:onMessage.count()+onDisconnect.count()})};
}
test('extension connects once, verifies challenge, sends signed read, verifies receipt and disconnects',async()=>{
 const f=await fixture(),result=await exchangeNativeRead({runtime:f.runtime,client:f.client,task});
 assert.equal(result.status,'completed');assert.equal(result.receipt.resultDigest,'a'.repeat(64));
 assert.deepEqual(f.counts(),{dispatched:1,posted:1,opened:1,closed:1,listeners:0});
});
test('missing host and disconnect before dispatch are held; after dispatch unknown and no automatic retry',async()=>{
 for(const mode of ['missing','before','lost']){
  const f=await fixture(mode),r=await exchangeNativeRead({runtime:f.runtime,client:f.client,task});
  assert.equal(r.status,mode==='lost'?'reconcile-required':'held');
  assert.equal(f.counts().opened,1);assert.equal(f.counts().posted,mode==='lost'?1:0);assert.equal(f.counts().listeners,0);
 }
});
test('bounded timeout removes all listeners and never attempts another port',async()=>{
 const f=await fixture('silent');
 const r=await exchangeNativeRead({runtime:f.runtime,client:f.client,task,timeoutMs:20});
 assert.equal(r.status,'held');assert.equal(f.counts().opened,1);assert.equal(f.counts().posted,0);assert.equal(f.counts().listeners,0);
});

test('host exit immediately after a complete signed receipt does not discard the receipt',async()=>{
 const f=await fixture('exit-after-receipt');
 const r=await exchangeNativeRead({runtime:f.runtime,client:f.client,task});
 assert.equal(r.status,'completed');assert.equal(f.counts().posted,1);assert.equal(f.counts().listeners,0);
});
test('invalid receipt after dispatch is uncertain, not a completed action',async()=>{
 const f=await fixture('tampered');
 const r=await exchangeNativeRead({runtime:f.runtime,client:f.client,task});
 assert.equal(r.status,'reconcile-required');assert.equal(f.counts().posted,1);assert.equal(f.counts().opened,1);
});

test('elapsed exchange deadline prevents dispatch even before delayed timer callback',async()=>{
 const onMessage=event(),onDisconnect=event();let posts=0;
 const pending=exchangeNativeRead({timeoutMs:10,task,
  client:{signRead:async()=>({}),verifyReceipt:async()=>({status:'completed'})},
  runtime:{connectNative:()=>({onMessage,onDisconnect,disconnect(){},postMessage(){posts++;onMessage.emit({});}})}});
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,35);
 onMessage.emit({});
 assert.equal((await pending).status,'held');assert.equal(posts,0);
 assert.equal(onMessage.count()+onDisconnect.count(),0);
});
