const ID=/^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const EXT=/^chrome-extension:\/\/[a-p]{32}\/$/;
const hex=b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
const pem=b=>'-----BEGIN PUBLIC KEY-----\n'+btoa(String.fromCharCode(...new Uint8Array(b)))+'\n-----END PUBLIC KEY-----';
export async function createLocalPairing({hostId,hostPublicKey,fingerprint,extensionOrigin}={}){
 if(typeof hostId!=='string'||!ID.test(hostId)||typeof extensionOrigin!=='string'||!EXT.test(extensionOrigin)||
  typeof hostPublicKey!=='string'||hostPublicKey.length>512||typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/i.test(fingerprint))
   throw Error('Invalid pairing inputs');
 const m=/^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/.exec(hostPublicKey.trim());
 if(!m)throw Error('Expected public SPKI PEM');
 const bytes=Uint8Array.from(atob(m[1].replace(/\s/g,'')),c=>c.charCodeAt(0));
 if(hex(await crypto.subtle.digest('SHA-256',bytes))!==fingerprint.toLowerCase())throw Error('Host fingerprint mismatch');
 const key=await crypto.subtle.importKey('spki',bytes,'Ed25519',false,['verify']);
 const device=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
 return Object.freeze({hostId,extensionOrigin,deviceId:'device-'+crypto.randomUUID(),hostPublicKey:key,
  devicePrivateKey:device.privateKey,devicePublicKey:pem(await crypto.subtle.exportKey('spki',device.publicKey)),
  idempotencyKey:'read:'+crypto.randomUUID()});
}
export function publicEnrollment(p){return Object.freeze({hostId:p.hostId,deviceId:p.deviceId,extensionOrigin:p.extensionOrigin,devicePublicKey:p.devicePublicKey});}
export function canaryTask(p){return Object.freeze({origin:'https://ultron-mw-cloud.hatchable.site',actorRef:'owner:ultron',operation:'page.inspect',scope:'page.read',maxPaidCents:0,idempotencyKey:p.idempotencyKey,path:'/browser-write-acceptance.html'});}
