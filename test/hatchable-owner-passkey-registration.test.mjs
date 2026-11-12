import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyOwnerPasskeyRegistration} from '../cloud/hatchable/lib/webauthn-owner.js';

const b64=b=>Buffer.from(b).toString('base64url');
const txt=s=>new TextEncoder().encode(s);
const cat=(...parts)=>Uint8Array.from(parts.flatMap(p=>[...p]));
function head(major,len){
 if(len<24)return Uint8Array.of((major<<5)|len);
 if(len<256)return Uint8Array.of((major<<5)|24,len);
 if(len<65536)return Uint8Array.of((major<<5)|25,len>>8,len&255);
 throw Error('large fixture');
}
function cbor(v){
 if(v===true||v===false)return Uint8Array.of(v?0xf5:0xf4);
 if(v instanceof Uint8Array)return cat(head(2,v.length),v);
 if(typeof v==='number')return head(v<0?1:0,v<0?-1-v:v);
 if(typeof v==='string'){const b=txt(v);return cat(head(3,b.length),b);}
 if(v instanceof Map)return cat(head(5,v.size),...[...v].flatMap(([k,z])=>[cbor(k),cbor(z)]));
 throw Error('invalid fixture');
}
async function fixture({origin='https://ultron-mw-cloud.hatchable.site',
 rpId='ultron-mw-cloud.hatchable.site',flags=0x45,alg=-7,fmt='none',
 clientChallenge=null,extensions=null}={}){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 const credentialId=webcrypto.getRandomValues(new Uint8Array(32));
 const challenge=b64(webcrypto.getRandomValues(new Uint8Array(32)));
 const rpHash=new Uint8Array(await webcrypto.subtle.digest('SHA-256',txt(rpId)));
 const cose=cbor(new Map([[1,2],[3,alg],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],
  [-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const auth=cat(rpHash,Uint8Array.of(flags,0,0,0,1),new Uint8Array(16),
  Uint8Array.of(0,credentialId.length),credentialId,cose,
  ...(extensions?[cbor(extensions)]:[]));
 const attestationObject=b64(cbor(new Map([['fmt',fmt],['attStmt',new Map()],
  ['authData',auth]])));
 const clientDataJSON=b64(txt(JSON.stringify({type:'webauthn.create',
  challenge:clientChallenge??challenge,origin,crossOrigin:false})));
 return {credentialId:b64(credentialId),challenge,attestationObject,clientDataJSON,
  expectedPublicKey:jwk};
}
test('registers exact origin, RP, ES256 COSE and user-verified passkey',async()=>{
 const f=await fixture();
 const result=await verifyOwnerPasskeyRegistration(f,{subtle:webcrypto.subtle});
 assert.equal(result.credentialId,f.credentialId);
 assert.equal(result.signCount,1);
 const imported=await webcrypto.subtle.importKey('spki',
  Buffer.from(result.publicKeySpki,'base64url'),{name:'ECDSA',namedCurve:'P-256'},
  false,['verify']);
 assert.equal(imported.type,'public');
 const isolated=await verifyOwnerPasskeyRegistration(f,{
  subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle)}});
 assert.equal(isolated.credentialId,f.credentialId);
});
test('rejects malformed, cross-origin, non-ES256 and missing user verification',async()=>{
 const cases=[
  await fixture({origin:'https://other.example'}),
  await fixture({rpId:'other.example'}),
  await fixture({flags:0x41}),
  await fixture({alg:-257}),
  await fixture({fmt:'packed'}),
  await fixture({clientChallenge:b64(new Uint8Array(32).fill(7))})
 ];
 for(const x of cases)await assert.rejects(
  verifyOwnerPasskeyRegistration(x,{subtle:webcrypto.subtle}),/passkey-/);
 const f=await fixture();
 await assert.rejects(verifyOwnerPasskeyRegistration({...f,credentialId:b64(new Uint8Array(32).fill(3))},
  {subtle:webcrypto.subtle}),/passkey-/);
});

test('accepts valid ES256 WebAuthn registration with Windows-compatible CBOR extensions',async()=>{
 const x=await fixture({flags:0xc5,
  extensions:new Map([['credProps',new Map([['rk',true]])]])});
 const verified=await verifyOwnerPasskeyRegistration(x,{subtle:webcrypto.subtle});
 assert.equal(verified.credentialId,x.credentialId);
});
test('rejects ED flag without extension CBOR payload',async()=>{
 const x=await fixture({flags:0xc5});
 await assert.rejects(verifyOwnerPasskeyRegistration(x,{subtle:webcrypto.subtle}),/passkey-/);
});

test('rejects authenticator extension bytes without ED and non-map ED CBOR',async()=>{
 const cases=[
  await fixture({flags:0x45,extensions:new Map([['credProps',new Map([['rk',true]])]])}),
  await fixture({flags:0xc5,extensions:'not-a-map'})
 ];
 for(const value of cases)await assert.rejects(
  verifyOwnerPasskeyRegistration(value,{subtle:webcrypto.subtle}),/passkey-/);
});
