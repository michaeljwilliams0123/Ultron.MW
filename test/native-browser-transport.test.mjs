import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {createNativeBrowserSession,serveNativeBrowserPort,encodeNativeFrame,readNativeFrame,createChromiumHostManifest} from '../src/computer/native-browser-transport.mjs';

const origin='https://ultron-mw-cloud.hatchable.site';
const extensionOrigin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const now=1800000000000;
const task={origin,actorRef:'owner:ultron',operation:'page.inspect',scope:'page.read',maxPaidCents:0,idempotencyKey:'read:browser001',path:'/browser-write-acceptance.html'};
const pem=key=>key.export({type:'spki',format:'pem'});
const sig=(key,body)=>sign(null,Buffer.from(JSON.stringify(body)),key).toString('base64url');
const signed=(key,body)=>({body,signature:sig(key,body)});
function fixture(){
 const device=generateKeyPairSync('ed25519'),host=generateKeyPairSync('ed25519');
 let time=now,active=true,calls=0;
 const options={extensionOrigin,callerOrigin:extensionOrigin,hostId:'ultron-local-browser',deviceId:'owner-device',devicePublicKey:pem(device.publicKey),hostPrivateKey:host.privateKey,
  actorRef:task.actorRef,origin,paths:[task.path],clock:()=>time,
  authorize:async()=>active,worker:{execute:async t=>{calls++;assert.deepEqual(t,task);return {status:'completed',bindingId:'playwright-owner',actorRef:t.actorRef,operation:t.operation,effect:'read',costCents:0,idempotencyKey:t.idempotencyKey,resultDigest:'a'.repeat(64),data:'do not disclose'};}}};
 const request=(challenge,changes={})=>signed(device.privateKey,{purpose:'ultron.native-browser.read.v1',hostId:options.hostId,deviceId:options.deviceId,extensionOrigin,challenge:challenge.body.challenge,expiresAt:now+1000,task,...changes});
 return {options,host,device,request,calls:()=>calls,revoke:()=>{active=false;},expire:()=>{time=now+2000;}};
}
test('one signed native request returns an authenticated receipt without page data',async()=>{
 const f=fixture(),s=createNativeBrowserSession(f.options),c=s.challenge;
 assert.equal(verify(null,Buffer.from(JSON.stringify(c.body)),f.host.publicKey,Buffer.from(c.signature,'base64url')),true);
 const r=await s.accept(f.request(c));
 assert.equal(r.body.status,'completed');
 assert.equal(r.body.receipt.resultDigest,'a'.repeat(64));
 assert.equal(JSON.stringify(r).includes('do not disclose'),false);
 assert.equal(verify(null,Buffer.from(JSON.stringify(r.body)),f.host.publicKey,Buffer.from(r.signature,'base64url')),true);
 assert.equal((await s.accept(f.request(c))).body.status,'held');
 assert.equal(f.calls(),1);
});
test('wrong extension, altered signature, replay on a fresh challenge, expired or revoked request and out-of-scope path fail closed',async()=>{
 const f=fixture();
 assert.throws(()=>createNativeBrowserSession({...f.options,callerOrigin:'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'}));
 const a=createNativeBrowserSession(f.options),b=createNativeBrowserSession(f.options);
 const m=f.request(a.challenge);
 assert.equal((await b.accept(m)).body.status,'held');
 const c=createNativeBrowserSession(f.options);
 const bad=f.request(c.challenge);bad.body.task={...task,path:'/other'};
 assert.equal((await c.accept(bad)).body.status,'held');
 const d=createNativeBrowserSession(f.options);
 assert.equal((await d.accept(f.request(d.challenge,{task:{...task,path:'/other'}}))).body.status,'held');
 const e=createNativeBrowserSession(f.options);f.expire();
 assert.equal((await e.accept(f.request(e.challenge))).body.status,'held');
 const g=fixture(),h=createNativeBrowserSession(g.options);g.revoke();
 assert.equal((await h.accept(g.request(h.challenge))).body.status,'held');
 assert.equal(f.calls()+g.calls(),0);
});
test('native stdio accepts fragmented frames and rejects oversize, malformed and truncated frames',async()=>{
 const f=fixture(),input=new PassThrough(),output=new PassThrough();
 const done=serveNativeBrowserPort({input,output,...f.options});
 const c=await readNativeFrame(output);
 const bytes=encodeNativeFrame(f.request(c));
 input.write(bytes.subarray(0,2));input.write(bytes.subarray(2,12));input.end(bytes.subarray(12));
 const result=await readNativeFrame(output);
 await done;
 assert.equal(result.body.status,'completed');
 assert.equal(f.calls(),1);
 for(const bad of [Buffer.from([0xff,0xff,0xff,0x7f]),Buffer.from([1,0,0,0,0xff]),Buffer.from([5,0,0,0,123])]){
  const stream=new PassThrough();stream.end(bad);
  await assert.rejects(readNativeFrame(stream));
 }
});
test('Chromium manifest permits one exact extension and an absolute executable',()=>{
 const m=createChromiumHostManifest({extensionOrigin,executable:'C:\\Ultron\\native-host.exe'});
 assert.deepEqual(m.allowed_origins,[extensionOrigin]);
 assert.equal(m.type,'stdio');
 assert.throws(()=>createChromiumHostManifest({extensionOrigin:'chrome-extension://*/',executable:'C:\\Ultron\\native-host.exe'}));
 assert.throws(()=>createChromiumHostManifest({extensionOrigin,executable:'native-host.exe'}));
});

test('a fresh native session after worker recreation reuses the PostgreSQL receipt without dispatching again',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {readFileSync}=await import('node:fs');
 const {createDurableWebReadWorker}=await import('../src/durable-web-read-worker.mjs');
 const db=new PGlite();
 let executions=0;
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql',import.meta.url),'utf8'));
  const f=fixture();
  const binding={id:'playwright-owner',provider:'playwright',runtime:'local-node',actorRef:task.actorRef,authMethod:'local-owner',origins:[origin],operations:[{name:'page.inspect',effect:'read',scope:'page.read'}],expiresAt:'2027-12-31T00:00:00Z',maxCostCents:0,credentialRef:null};
  const adapter={health:async()=>({status:'ready',actorRef:task.actorRef,grantedScopes:['page.read']}),execute:async()=>{executions++;return {headingCount:1};},observe:async()=>({verified:true,origin}),unbind:async()=>({revoked:true})};
  const worker=()=>createDurableWebReadWorker({db,routes:[{protocol:'playwright',binding,adapter,allowedPaths:[task.path]}],clock:()=>new Date(now).toISOString(),authorizeRead:async()=>true});
  const a=createNativeBrowserSession({...f.options,worker:worker()});
  const first=await a.accept(f.request(a.challenge));
  assert.equal(first.body.status,'completed');
  const b=createNativeBrowserSession({...f.options,worker:worker()});
  assert.equal((await b.accept(f.request(a.challenge))).body.status,'held');
  const c=createNativeBrowserSession({...f.options,worker:worker()});
  const again=await c.accept(f.request(c.challenge));
  assert.equal(again.body.status,'completed');
  assert.equal(again.body.receipt.resumed,true);
  assert.equal(again.body.receipt.resultDigest,first.body.receipt.resultDigest);
  assert.equal(executions,1);
  const {rows}=await db.query('SELECT status,receipt FROM capability_attempts');
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,'completed');
  assert.equal(JSON.stringify(rows).includes('headingCount'),false);
 }finally{await db.close();}
});

test('concurrent frames admit only one request and an uncertain provider outcome is not called completed',async()=>{
 const f=fixture();
 let entered=0;
 const s=createNativeBrowserSession({...f.options,worker:{execute:async()=>{entered++;throw Error('lost acknowledgment');}}});
 const m=f.request(s.challenge);
 const [a,b]=await Promise.all([s.accept(m),s.accept(m)]);
 assert.equal(a.body.status,'reconcile-required');
 assert.equal(b.body.status,'held');
 assert.equal(entered,1);
});

test('WebCrypto browser client verifies pinned host, signs exact task, and rejects a modified receipt',async()=>{
 const {createNativeBrowserClient}=await import('../src/computer/native-browser-client.mjs');
 const f=fixture(),s=createNativeBrowserSession(f.options);
 const webDevice=await crypto.subtle.importKey('pkcs8',f.device.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
 const webHost=await crypto.subtle.importKey('spki',f.host.publicKey.export({format:'der',type:'spki'}),'Ed25519',true,['verify']);
 const c=createNativeBrowserClient({hostId:f.options.hostId,deviceId:f.options.deviceId,extensionOrigin,hostPublicKey:webHost,devicePrivateKey:webDevice,clock:()=>now,authorize:async()=>true});
 const envelope=await c.signRead(s.challenge,task);
 const r=await s.accept(envelope);
 assert.equal((await c.verifyReceipt(r)).status,'completed');
 const tampered={...r,body:{...r.body,status:'held'}};
 await assert.rejects(c.verifyReceipt(tampered));
 const other=createNativeBrowserSession(fixture().options);
 await assert.rejects(c.signRead(other.challenge,task));
 const bad=await crypto.subtle.importKey('pkcs8',f.device.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',true,['sign']);
 assert.throws(()=>createNativeBrowserClient({hostId:f.options.hostId,deviceId:f.options.deviceId,extensionOrigin,hostPublicKey:webHost,devicePrivateKey:bad,authorize:async()=>true}));
});

test('browser JSON property ordering cannot invalidate an otherwise signed challenge or receipt',async()=>{
 const {createNativeBrowserClient}=await import('../src/computer/native-browser-client.mjs');
 const f=fixture(),s=createNativeBrowserSession(f.options);
 const webDevice=await crypto.subtle.importKey('pkcs8',f.device.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
 const webHost=await crypto.subtle.importKey('spki',f.host.publicKey.export({format:'der',type:'spki'}),'Ed25519',true,['verify']);
 const opts={hostId:f.options.hostId,deviceId:f.options.deviceId,extensionOrigin,hostPublicKey:webHost,devicePrivateKey:webDevice,clock:()=>now,authorize:async()=>true};
 const reorder=v=>v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;
 const c=createNativeBrowserClient(opts);
 const envelope=await c.signRead(reorder(s.challenge),task);
 const r=await s.accept(reorder(envelope));
 assert.equal((await c.verifyReceipt(reorder(r))).status,'completed');
 const foreign=createNativeBrowserSession(fixture().options);
 await assert.rejects(createNativeBrowserClient(opts).signRead(foreign.challenge,task),/signature/);
});

test('native protocol survives actual host process restart with a persistent PostgreSQL-compatible ledger',async()=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {fileURLToPath}=await import('node:url');
 const {PGlite}=await import('@electric-sql/pglite');
 const f=fixture(),directory=await mkdtemp(join(tmpdir(),'ultron-native-pipe-'));
 const dbPath=join(directory,'pg'),marker=join(directory,'dispatches.txt');
 try{
  const db=new PGlite(dbPath);
  try{await db.exec(await readFile(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql',import.meta.url),'utf8'));}finally{await db.close();}
  const program=[
   "import {createPrivateKey} from 'node:crypto';",
   "import {appendFile} from 'node:fs/promises';",
   "import {PGlite} from '@electric-sql/pglite';",
   "import {serveNativeBrowserPort} from './src/computer/native-browser-transport.mjs';",
   "import {createDurableWebReadWorker} from './src/durable-web-read-worker.mjs';",
   "const fixture=JSON.parse(process.env.ULTRON_NATIVE_TEST_FIXTURE);",
   "const db=new PGlite(fixture.dbPath);",
   "const t=fixture.task;",
   "const binding={id:'playwright-owner',provider:'playwright',runtime:'local-node',actorRef:t.actorRef,authMethod:'local-owner',origins:[t.origin],operations:[{name:'page.inspect',effect:'read',scope:'page.read'}],expiresAt:'2027-12-31T00:00:00Z',maxCostCents:0,credentialRef:null};",
   "const adapter={health:async()=>({status:'ready',actorRef:t.actorRef,grantedScopes:['page.read']}),execute:async()=>{await appendFile(fixture.marker,'dispatch\\n');return {headingCount:1};},observe:async()=>({verified:true,origin:t.origin}),unbind:async()=>({revoked:true})};",
   "const worker=createDurableWebReadWorker({db,routes:[{protocol:'playwright',binding,adapter,allowedPaths:[t.path]}],clock:()=>new Date(fixture.now).toISOString(),authorizeRead:async()=>true});",
   "try{await serveNativeBrowserPort({input:process.stdin,output:process.stdout,extensionOrigin:fixture.extensionOrigin,callerOrigin:process.argv[1],hostId:fixture.hostId,deviceId:fixture.deviceId,devicePublicKey:fixture.devicePublicKey,hostPrivateKey:createPrivateKey(fixture.hostKey),actorRef:t.actorRef,origin:t.origin,paths:[t.path],authorize:async()=>true,worker,clock:()=>fixture.now});}finally{await db.close();}"
  ].join('\n');
  const provision={dbPath,marker,task,now,extensionOrigin,hostId:f.options.hostId,deviceId:f.options.deviceId,devicePublicKey:f.options.devicePublicKey,hostKey:f.host.privateKey.export({format:'pem',type:'pkcs8'})};
  async function execute(){
   const child=spawn(process.execPath,['--input-type=module','-e',program,extensionOrigin],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,ULTRON_NATIVE_TEST_FIXTURE:JSON.stringify(provision)},stdio:['pipe','pipe','pipe'],windowsHide:true});
   const done=once(child,'close');let stderr='';
   child.stderr.on('data',b=>{stderr+=b.toString();});
   try{
    const challenge=await readNativeFrame(child.stdout);
    child.stdin.end(encodeNativeFrame(f.request(challenge)));
    const result=await readNativeFrame(child.stdout);
    const [code]=await done;
    assert.equal(code,0,stderr);
    assert.equal(verify(null,Buffer.from(JSON.stringify(result.body)),f.host.publicKey,Buffer.from(result.signature,'base64url')),true);
    return result.body;
   }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await done;}}
  }
  const a=await execute(),b=await execute();
  assert.equal(a.status,'completed');assert.equal(a.receipt.resumed,false);
  assert.equal(b.status,'completed');assert.equal(b.receipt.resumed,true);
  assert.equal(a.receipt.resultDigest,b.receipt.resultDigest);
  assert.equal(await readFile(marker,'utf8'),'dispatch\n');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('non-data accessor properties and malformed origin strings fail closed with normalized errors',async()=>{
 const {createNativeBrowserClient}=await import('../src/computer/native-browser-client.mjs');
 const f=fixture(),s=createNativeBrowserSession(f.options);
 let hostGetterCalls=0,clientGetterCalls=0;
 const hostTask={...task};
 Object.defineProperty(hostTask,'path',{enumerable:true,get(){hostGetterCalls++;return task.path;}});
 const hostMsg=f.request(s.challenge,{task:hostTask});
 hostGetterCalls=0;
 const res=await s.accept(hostMsg);
 assert.equal(res.body.status,'held');
 assert.equal(hostGetterCalls,0);
 assert.equal(f.calls(),0);
 const webDevice=await crypto.subtle.importKey('pkcs8',f.device.privateKey.export({format:'der',type:'pkcs8'}),'Ed25519',false,['sign']);
 const webHost=await crypto.subtle.importKey('spki',f.host.publicKey.export({format:'der',type:'spki'}),'Ed25519',true,['verify']);
 const c=createNativeBrowserClient({hostId:f.options.hostId,deviceId:f.options.deviceId,extensionOrigin,hostPublicKey:webHost,devicePrivateKey:webDevice,clock:()=>now,authorize:async()=>true});
 const clientTask={...task};
 Object.defineProperty(clientTask,'path',{enumerable:true,get(){clientGetterCalls++;return task.path;}});
 await assert.rejects(c.signRead(s.challenge,clientTask),/native-browser-task-invalid/);
 assert.equal(clientGetterCalls,0);
 const c2=createNativeBrowserClient({hostId:f.options.hostId,deviceId:f.options.deviceId,extensionOrigin,hostPublicKey:webHost,devicePrivateKey:webDevice,clock:()=>now,authorize:async()=>true});
 await assert.rejects(c2.signRead(s.challenge,{...task,origin:'not-a-url'}),/native-browser-task-invalid/);
});
