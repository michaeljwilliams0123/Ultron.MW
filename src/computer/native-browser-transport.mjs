import {createPublicKey,randomBytes,sign,verify} from 'node:crypto';
import {endianness} from 'node:os';
import {isAbsolute,win32} from 'node:path';

const EXT=/^chrome-extension:\/\/[a-p]{32}\/$/;
const ID=/^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const TASK_ID=/^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const PATH=/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const MAX_FRAME=32768;
const LIFETIME=30000;
const little=endianness()==='LE';
const keys=['origin','actorRef','operation','scope','maxPaidCents','idempotencyKey','path'];
const exact=(v,k)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const pathOk=p=>typeof p==='string'&&p.length<=512&&PATH.test(p)&&!p.split('/').some(x=>x==='.'||x==='..');
const validOrigin=o=>{try{const u=new URL(o);return u.protocol==='https:'&&u.origin===o;}catch{return false;}};
const seal=(key,body)=>Object.freeze({body:Object.freeze(body),signature:sign(null,Buffer.from(JSON.stringify(body)),key).toString('base64url')});

export function createChromiumHostManifest({extensionOrigin,executable}={}){
 if(!EXT.test(extensionOrigin||'')||typeof executable!=='string'||!executable.trim()||/[\x00-\x1f]/.test(executable)||
   !(isAbsolute(executable)||win32.isAbsolute(executable))||!/\.(?:exe|cmd|bat)$/i.test(executable))
  throw Error('native-browser-manifest-invalid');
 return Object.freeze({name:'com.ultron.browser',description:'Ultron bounded browser read companion',path:executable,type:'stdio',allowed_origins:Object.freeze([extensionOrigin])});
}

export function encodeNativeFrame(message){
 const json=Buffer.from(JSON.stringify(message),'utf8');
 if(json.length===0||json.length>MAX_FRAME)throw Error('native-browser-frame-size');
 const header=Buffer.alloc(4);
 if(little)header.writeUInt32LE(json.length);else header.writeUInt32BE(json.length);
 return Buffer.concat([header,json]);
}
function readExact(stream,size,deadline){
 return new Promise((resolve,reject)=>{
  let timer;
  function cleanup(){clearTimeout(timer);stream.off('readable',pull);stream.off('end',ended);stream.off('close',ended);stream.off('error',failed);}
  function failed(e){cleanup();reject(e);}
  function ended(){failed(Error('native-browser-frame-truncated'));}
  function pull(){
   try{
    const bytes=stream.read(size);
    if(bytes!==null){
     if(!Buffer.isBuffer(bytes)||bytes.length!==size)return ended();
     cleanup();resolve(bytes);
    }else if(stream.readableEnded||stream.destroyed)ended();
   }catch(e){failed(e);}
  }
  const remaining=deadline-Date.now();
  if(remaining<=0)return failed(Error('native-browser-frame-timeout'));
  stream.on('readable',pull);stream.once('end',ended);stream.once('close',ended);stream.once('error',failed);
  timer=setTimeout(()=>failed(Error('native-browser-frame-timeout')),remaining);
  pull();
 });
}
export async function readNativeFrame(stream,{timeoutMs=LIFETIME}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>LIFETIME)throw Error('native-browser-frame-timeout-invalid');
 const deadline=Date.now()+timeoutMs;
 const header=await readExact(stream,4,deadline);
 const size=little?header.readUInt32LE():header.readUInt32BE();
 if(size<1||size>MAX_FRAME)throw Error('native-browser-frame-size');
 return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await readExact(stream,size,deadline)));
}
function writeFrame(output,message){
 const bytes=encodeNativeFrame(message);
 return new Promise((resolve,reject)=>output.write(bytes,error=>error?reject(error):resolve()));
}

/** One native messaging port, one authenticated read, no listening socket.
 * The caller argument is only an allowlist check, not proof of device identity.
 * Trusted local provisioning pins both signing keys and current owner policy.
 */
export function createNativeBrowserSession({extensionOrigin,callerOrigin,hostId,deviceId,devicePublicKey,hostPrivateKey,actorRef,origin,paths,authorize,worker,clock=Date.now}={}){
 if(!EXT.test(extensionOrigin||'')||callerOrigin!==extensionOrigin||!ID.test(hostId||'')||!ID.test(deviceId||'')||
    !ID.test(actorRef||'')||!validOrigin(origin)||!Array.isArray(paths)||!paths.length||paths.length>32||
    paths.some(p=>!pathOk(p))||typeof authorize!=='function'||typeof worker?.execute!=='function'||typeof clock!=='function'||
    hostPrivateKey?.type!=='private'||hostPrivateKey.asymmetricKeyType!=='ed25519')throw Error('native-browser-registration-invalid');
 const allowedPaths=new Set(paths);
 const deviceKey=createPublicKey(devicePublicKey);
 const hostKey=createPublicKey(hostPrivateKey);
 if(deviceKey.asymmetricKeyType!=='ed25519'||deviceKey.equals(hostKey))throw Error('native-browser-key-invalid');
 const issued=clock();
 if(!Number.isSafeInteger(issued)||issued<0||issued>Number.MAX_SAFE_INTEGER-LIFETIME)throw Error('native-browser-clock-invalid');
 const expires=issued+LIFETIME;
 const challenge=randomBytes(32).toString('hex');
 const context={hostId,deviceId,extensionOrigin,challenge};
 let used=false;
 const response=(status,receipt)=>seal(hostPrivateKey,{purpose:'ultron.native-browser.receipt.v1',...context,status,receipt,productionAccepted:false});
 const held=()=>response('held',null);
 const isLive=deadline=>{const now=clock();return Number.isSafeInteger(now)&&now>=issued&&now<expires&&now<deadline;};
 return Object.freeze({
  challenge:seal(hostPrivateKey,{purpose:'ultron.native-browser.challenge.v1',...context,expiresAt:expires}),
  async accept(message){
   if(used)return held();
   used=true;
   let task;
   try{
    if(!exact(message,['body','signature'])||typeof message.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(message.signature))return held();
    const b=message.body;
    if(!exact(b,['purpose','hostId','deviceId','extensionOrigin','challenge','expiresAt','task'])||
       b.purpose!=='ultron.native-browser.read.v1'||b.hostId!==hostId||b.deviceId!==deviceId||b.extensionOrigin!==extensionOrigin||b.challenge!==challenge||
       !Number.isSafeInteger(b.expiresAt)||b.expiresAt>expires||!isLive(b.expiresAt)||!exact(b.task,keys))return held();
    task=Object.freeze(Object.fromEntries(keys.map(k=>[k,b.task[k]])));
    if(task.origin!==origin||task.actorRef!==actorRef||task.operation!=='page.inspect'||task.scope!=='page.read'||task.maxPaidCents!==0||
       !TASK_ID.test(task.idempotencyKey||'')||typeof task.idempotencyKey!=='string'||!allowedPaths.has(task.path))return held();
    const signedBody={purpose:b.purpose,...context,expiresAt:b.expiresAt,task};
    const signature=Buffer.from(message.signature,'base64url');
    if(signature.length!==64||signature.toString('base64url')!==message.signature||
       !verify(null,Buffer.from(JSON.stringify(signedBody)),deviceKey,signature))return held();
    const deadline=b.expiresAt;
    if(await authorize(Object.freeze({hostId,deviceId,extensionOrigin,task}))!==true||!isLive(deadline))return held();
   }catch{return held();}
   try{
    const r=await worker.execute(task);
    // This transport exposes only a small receipt, never page payloads.
    if(r?.status==='completed'&&r.idempotencyKey===task.idempotencyKey&&ID.test(r.bindingId||'')&&DIGEST.test(r.resultDigest||'')&&
       r.actorRef===task.actorRef&&r.operation===task.operation&&r.effect==='read'&&r.costCents===0){
      return response('completed',Object.freeze({bindingId:r.bindingId,idempotencyKey:task.idempotencyKey,resultDigest:r.resultDigest,resumed:r.resumed===true}));
    }
    if(r?.status==='held'||r?.status==='approval-required')return held();
    return response('reconcile-required',Object.freeze({idempotencyKey:task.idempotencyKey}));
   }catch{return response('reconcile-required',Object.freeze({idempotencyKey:task.idempotencyKey}));}
  }
 });
}
export async function serveNativeBrowserPort({input,output,...options}){
 const session=createNativeBrowserSession(options);
 await writeFrame(output,session.challenge);
 const message=await readNativeFrame(input);
 await writeFrame(output,await session.accept(message));
}
