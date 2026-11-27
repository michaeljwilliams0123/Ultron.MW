/** Browser-side cryptographic peer. No browser permissions, persistence, or
 * automatic execution. The extension composition must supply locally paired
 * keys and an owner-approved task through a trusted extension-only context. */
const EXT=/^chrome-extension:\/\/[a-p]{32}\/$/;
const ID=/^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const KEY=/^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const HASH=/^[a-f0-9]{64}$/;
const FIELDS=['origin','actorRef','operation','scope','maxPaidCents','idempotencyKey','path'];
const exact=(v,k)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const bytes=v=>new TextEncoder().encode(JSON.stringify(v));
const base64url=v=>btoa(String.fromCharCode(...v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function signature(v){
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(v))throw Error('native-browser-signature-invalid');
 const b=Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')+'=='),c=>c.charCodeAt(0));
 if(b.length!==64||base64url(b)!==v)throw Error('native-browser-signature-invalid');
 return b;
}
function readTask(raw){
 if(!exact(raw,FIELDS))throw Error('native-browser-task-invalid');
 const t=Object.freeze(Object.fromEntries(FIELDS.map(k=>[k,raw[k]])));
 const u=new URL(t.origin);
 if(typeof t.origin!=='string'||u.protocol!=='https:'||u.origin!==t.origin||typeof t.actorRef!=='string'||!ID.test(t.actorRef)||
  t.operation!=='page.inspect'||t.scope!=='page.read'||t.maxPaidCents!==0||typeof t.idempotencyKey!=='string'||!KEY.test(t.idempotencyKey)||
  typeof t.path!=='string'||t.path.length>512||!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/.test(t.path)||t.path.split('/').some(x=>x==='.'||x==='..'))
  throw Error('native-browser-task-invalid');
 return t;
}
export function createNativeBrowserClient({hostId,deviceId,extensionOrigin,hostPublicKey,devicePrivateKey,authorize,clock=Date.now,subtle=globalThis.crypto?.subtle}={}){
 if(!ID.test(hostId||'')||!ID.test(deviceId||'')||!EXT.test(extensionOrigin||'')||typeof authorize!=='function'||typeof clock!=='function'||!subtle||
  hostPublicKey?.type!=='public'||hostPublicKey.algorithm?.name!=='Ed25519'||!hostPublicKey.usages.includes('verify')||
  devicePrivateKey?.type!=='private'||devicePrivateKey.algorithm?.name!=='Ed25519'||devicePrivateKey.extractable!==false||!devicePrivateKey.usages.includes('sign'))
  throw Error('native-browser-client-registration-invalid');
 let used=false,session=null;
 async function authenticated(message,fields){
  if(!exact(message,['body','signature'])||!exact(message.body,fields))throw Error('native-browser-envelope-invalid');
  const raw=structuredClone(message.body);
  // Native messaging serializers may reorder JSON properties. Reconstruct the
  // protocol's exact field order before checking the signed transcript.
  const b=Object.fromEntries(fields.map(k=>[k,raw[k]]));
  if(Object.hasOwn(b,'receipt')&&b.receipt!==null){
   const receiptFields=b.status==='completed'?['bindingId','idempotencyKey','resultDigest','resumed']:['idempotencyKey'];
   if(!exact(b.receipt,receiptFields))throw Error('native-browser-receipt-invalid');
   b.receipt=Object.fromEntries(receiptFields.map(k=>[k,b.receipt[k]]));
  }
  if(b.hostId!==hostId||b.deviceId!==deviceId||b.extensionOrigin!==extensionOrigin||typeof b.challenge!=='string'||!HASH.test(b.challenge))
   throw Error('native-browser-host-mismatch');
  if(await subtle.verify('Ed25519',hostPublicKey,signature(message.signature),bytes(b))!==true)throw Error('native-browser-host-signature-invalid');
  return b;
 }
 const live=expires=>{const n=clock();return Number.isSafeInteger(n)&&Number.isSafeInteger(expires)&&n<expires&&expires-n<=30000;};
 return Object.freeze({
  async signRead(challenge,raw){
   if(used)throw Error('native-browser-client-session-used');
   used=true;
   const task=readTask(raw);
   const b=await authenticated(challenge,['purpose','hostId','deviceId','extensionOrigin','challenge','expiresAt']);
   if(b.purpose!=='ultron.native-browser.challenge.v1'||!live(b.expiresAt))throw Error('native-browser-challenge-invalid');
   if(await authorize(task)!==true||!live(b.expiresAt))throw Error('native-browser-client-authorization-required');
   const body={purpose:'ultron.native-browser.read.v1',hostId,deviceId,extensionOrigin,challenge:b.challenge,expiresAt:b.expiresAt,task};
   const signed=base64url(new Uint8Array(await subtle.sign('Ed25519',devicePrivateKey,bytes(body))));
   if(!live(b.expiresAt))throw Error('native-browser-challenge-expired');
   session=Object.freeze({challenge:b.challenge,idempotencyKey:task.idempotencyKey});
   return Object.freeze({body:Object.freeze(body),signature:signed});
  },
  async verifyReceipt(message){
   if(!session)throw Error('native-browser-client-no-request');
   const b=await authenticated(message,['purpose','hostId','deviceId','extensionOrigin','challenge','status','receipt','productionAccepted']);
   if(b.purpose!=='ultron.native-browser.receipt.v1'||b.challenge!==session.challenge||b.productionAccepted!==false||
     !['completed','held','reconcile-required'].includes(b.status))throw Error('native-browser-receipt-invalid');
   if(b.status==='held'){if(b.receipt!==null)throw Error('native-browser-receipt-invalid');}
   else if(b.status==='completed'){
    if(!exact(b.receipt,['bindingId','idempotencyKey','resultDigest','resumed'])||b.receipt.idempotencyKey!==session.idempotencyKey||
      typeof b.receipt.bindingId!=='string'||!ID.test(b.receipt.bindingId)||typeof b.receipt.resultDigest!=='string'||!HASH.test(b.receipt.resultDigest)||typeof b.receipt.resumed!=='boolean')
     throw Error('native-browser-receipt-invalid');
   }else if(!exact(b.receipt,['idempotencyKey'])||b.receipt.idempotencyKey!==session.idempotencyKey)throw Error('native-browser-receipt-invalid');
   if(b.receipt)Object.freeze(b.receipt);
   return Object.freeze(b);
  }
 });
}
