import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const {verifyOwnerPasskeyAssertion}=await import(
 '../cloud/hatchable/lib/webauthn-owner.js');

const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const RP_ID='ultron-mw-cloud.hatchable.site';
const bytes=value=>new Uint8Array(value);
const b64=value=>Buffer.from(value).toString('base64url');

function derInteger(value){
 let start=0;
 while(start<value.length-1&&value[start]===0)start++;
 let body=value.slice(start);
 if(body[0]&0x80)body=Uint8Array.from([0,...body]);
 return Uint8Array.from([0x02,body.length,...body]);
}
function derSignature(raw){
 const r=derInteger(raw.slice(0,32)),s=derInteger(raw.slice(32));
 return Uint8Array.from([0x30,r.length+s.length,...r,...s]);
}
function concat(...parts){
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 let offset=0;
 for(const part of parts){out.set(part,offset);offset+=part.length;}
 return out;
}
async function fixture({origin=ORIGIN,rpId=RP_ID,challenge=b64(webcrypto.getRandomValues(new Uint8Array(32))),
 flags=0x05,signCount=7,clientChallenge=challenge}={}){
 const pair=await webcrypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const publicKeySpki=b64(bytes(await webcrypto.subtle.exportKey('spki',pair.publicKey)));
 const credentialId=b64(webcrypto.getRandomValues(new Uint8Array(32)));
 const clientDataJSON=bytes(new TextEncoder().encode(JSON.stringify({
  type:'webauthn.get',challenge:clientChallenge,origin,crossOrigin:false
 })));
 const rpHash=bytes(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(rpId)));
 const counter=Uint8Array.from([
  (signCount>>>24)&255,(signCount>>>16)&255,(signCount>>>8)&255,signCount&255
 ]);
 const authenticatorData=concat(rpHash,Uint8Array.of(flags),counter);
 const clientHash=bytes(await webcrypto.subtle.digest('SHA-256',clientDataJSON));
 const raw=bytes(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
  pair.privateKey,concat(authenticatorData,clientHash)));
 return {credentialId,publicKeySpki,challenge,
  authenticatorData:b64(authenticatorData),clientDataJSON:b64(clientDataJSON),
  signature:b64(derSignature(raw))};
}

test('owner passkey assertion verifies exact origin, RP, challenge and user verification',async()=>{
 const assertion=await fixture();
 const result=await verifyOwnerPasskeyAssertion({...assertion,
  expectedCredentialId:assertion.credentialId,subtle:webcrypto.subtle});
 assert.deepEqual(result,{credentialId:assertion.credentialId,signCount:7});
 // Hatchable isolates support SHA-256 digest but not asymmetric WebCrypto imports.
 const isolated=await verifyOwnerPasskeyAssertion({...assertion,
  expectedCredentialId:assertion.credentialId,
  subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle)}});
 assert.equal(isolated.signCount,7);
});

test('owner passkey assertion fails closed on target, freshness and presence drift',async()=>{
 const cases=[
  {name:'origin',assertion:await fixture({origin:'https://evil.example'})},
  {name:'rp',assertion:await fixture({rpId:'evil.example'})},
  {name:'challenge',assertion:await fixture({clientChallenge:b64(new Uint8Array(32).fill(9))})},
  {name:'user verification',assertion:await fixture({flags:0x01})}
 ];
 for(const entry of cases){
  await assert.rejects(verifyOwnerPasskeyAssertion({...entry.assertion,
   expectedCredentialId:entry.assertion.credentialId,subtle:webcrypto.subtle}),
  /passkey-/,entry.name);
 }
});

test('owner passkey assertion rejects another credential and malformed DER signature',async()=>{
 const assertion=await fixture();
 await assert.rejects(verifyOwnerPasskeyAssertion({...assertion,
  expectedCredentialId:b64(new Uint8Array(32).fill(1)),subtle:webcrypto.subtle}),
 /passkey-credential-mismatch/);
 await assert.rejects(verifyOwnerPasskeyAssertion({...assertion,
  signature:b64(Uint8Array.of(1,2,3)),expectedCredentialId:assertion.credentialId,
  subtle:webcrypto.subtle}),/passkey-signature-invalid/);
});
