import {createVerify} from 'node:crypto';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const RP_ID='ultron-mw-cloud.hatchable.site';
const B64=/^[A-Za-z0-9_-]+$/;

function refuse(reason){throw Error('passkey-'+reason);}
function decode(value,{min=1,max=4096}={}){
 if(typeof value!=='string'||value.length<min||value.length>max||!B64.test(value))
  refuse('encoding-invalid');
 let raw;
 try{raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+
   '='.repeat((4-value.length%4)%4));}
 catch{refuse('encoding-invalid');}
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function equal(a,b){
 if(a.length!==b.length)return false;
 let difference=0;
 for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 return difference===0;
}
function spkiPem(bytes){
 const chars=String.fromCharCode(...bytes);
 const base64=btoa(chars);
 return '-----BEGIN PUBLIC KEY-----\n'+
  base64.match(/.{1,64}/g).join('\n')+'\n-----END PUBLIC KEY-----';
}
function concat(a,b){
 const result=new Uint8Array(a.length+b.length);
 result.set(a);result.set(b,a.length);return result;
}
function integer(bytes,offset){
 if(bytes[offset++]!==0x02)refuse('signature-invalid');
 const length=bytes[offset++];
 if(!Number.isInteger(length)||length<1||length>33||offset+length>bytes.length)
  refuse('signature-invalid');
 let value=bytes.slice(offset,offset+length);
 let signPadding=false;
 if(value.length===33){
  if(value[0]!==0)refuse('signature-invalid');
  value=value.slice(1);signPadding=true;
 }
 if(!signPadding&&(value[0]&0x80))refuse('signature-invalid');
 while(value.length>1&&value[0]===0)value=value.slice(1);
 if(value.length>32)refuse('signature-invalid');
 const padded=new Uint8Array(32);padded.set(value,32-value.length);
 return {value:padded,offset:offset+length};
}
function derToRaw(bytes){
 if(bytes.length<8||bytes.length>72||bytes[0]!==0x30||bytes[1]!==bytes.length-2)
  refuse('signature-invalid');
 const r=integer(bytes,2),s=integer(bytes,r.offset);
 if(s.offset!==bytes.length)refuse('signature-invalid');
 return concat(r.value,s.value);
}

export async function verifyOwnerPasskeyAssertion({
 credentialId,expectedCredentialId,publicKeySpki,challenge,
 authenticatorData,clientDataJSON,signature,
 origin=ORIGIN,rpId=RP_ID,subtle=globalThis.crypto?.subtle
}={},{
 createVerifier=createVerify
}={}){
 if(!subtle||typeof credentialId!=='string'||credentialId!==expectedCredentialId)
  refuse(credentialId===expectedCredentialId?'crypto-unavailable':'credential-mismatch');
 decode(credentialId,{min:16,max:1024});
 const expectedChallenge=decode(challenge,{min:43,max:43});
 if(expectedChallenge.length!==32)refuse('challenge-invalid');
 const auth=decode(authenticatorData,{min:50,max:2048});
 if(auth.length<37)refuse('authenticator-data-invalid');
 const clientBytes=decode(clientDataJSON,{min:16,max:4096});
 let client;
 try{client=JSON.parse(new TextDecoder().decode(clientBytes));}
 catch{refuse('client-data-invalid');}
 if(!client||client.type!=='webauthn.get'||client.origin!==origin||
   (client.crossOrigin!==undefined&&client.crossOrigin!==false))
  refuse('client-data-invalid');
 let clientChallenge;
 try{clientChallenge=decode(client.challenge,{min:43,max:43});}
 catch{refuse('challenge-invalid');}
 if(!equal(clientChallenge,expectedChallenge))refuse('challenge-mismatch');
 const expectedRp=new Uint8Array(await subtle.digest('SHA-256',
  new TextEncoder().encode(rpId)));
 if(!equal(auth.slice(0,32),expectedRp))refuse('rp-mismatch');
 const flags=auth[32];
 if((flags&0x01)===0)refuse('user-presence-required');
 if((flags&0x04)===0)refuse('user-verification-required');
 const signCount=new DataView(auth.buffer,auth.byteOffset+33,4).getUint32(0,false);
 const key=spkiPem(decode(publicKeySpki,{min:80,max:1024}));
 const clientHash=new Uint8Array(await subtle.digest('SHA-256',clientBytes));
 let der;
 try{der=decode(signature,{min:80,max:128});derToRaw(der);}
 catch{refuse('signature-invalid');} // Reject malformed DER consistently.
 let verified=false;
 try{
  const v=createVerifier('sha256');
  v.update(concat(auth,clientHash));
  verified=v.verify(key,encodeB64(der).replace(/-/g,'+').replace(/_/g,'/'),'base64');
 }catch{refuse('signature-invalid');}
 if(!verified)refuse('signature-invalid');
 return {credentialId,signCount};
}


/* Minimal bounded CBOR decoder: WebAuthn attestation "none" and ES256 COSE only.
 * No trust is derived from attestation format alone; enrollment also requires
 * an existing owner-signed grant plus an atomic server-side challenge claim. */
function readCbor(data,cursor,depth=0){
 if(depth>7||cursor.i>=data.length)refuse('attestation-invalid');
 const initial=data[cursor.i++],major=initial>>5,info=initial&31;
 let len;
 if(info<24)len=info;
 else if(info===24){if(cursor.i>=data.length)refuse('attestation-invalid');len=data[cursor.i++];}
 else if(info===25){if(cursor.i+2>data.length)refuse('attestation-invalid');
  len=(data[cursor.i++]<<8)|data[cursor.i++];}
 else if(info===26){if(cursor.i+4>data.length)refuse('attestation-invalid');
  len=new DataView(data.buffer,data.byteOffset+cursor.i,4).getUint32(0,false);cursor.i+=4;}
 else refuse('attestation-invalid');
 if(len>16384)refuse('attestation-invalid');
 // COSE extension maps may contain CBOR booleans (e.g. credProps.rk).
 // Support only defined, bounded simple values; reject floats and breaks.
 if(major===7){
  if(info===20)return false;
  if(info===21)return true;
  if(info===22)return null;
  refuse('attestation-invalid');
 }
 if(major===0||major===1)return major===0?len:-1-len;
 if(major===2||major===3){
  if(cursor.i+len>data.length)refuse('attestation-invalid');
  const value=data.slice(cursor.i,cursor.i+len);cursor.i+=len;
  if(major===2)return value;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(value);}
  catch{refuse('attestation-invalid');}
 }
 if(major===4){
  const values=[];for(let i=0;i<len;i++)values.push(readCbor(data,cursor,depth+1));
  return values;
 }
 if(major===5){
  const values=new Map();
  for(let i=0;i<len;i++){
   const key=readCbor(data,cursor,depth+1);
   if(typeof key!=='number'&&typeof key!=='string')refuse('attestation-invalid');
   if(values.has(key))refuse('attestation-invalid');
   values.set(key,readCbor(data,cursor,depth+1));
  }
  return values;
 }
 refuse('attestation-invalid');
}
function encodeB64(bytes){
 let s='';for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function verifyOwnerPasskeyRegistration({
 credentialId,challenge,attestationObject,clientDataJSON
}={},{
 origin=ORIGIN,rpId=RP_ID,subtle=globalThis.crypto?.subtle,
 createVerifier=createVerify
}={}){
 if(!subtle)refuse('crypto-unavailable');
 const rawId=decode(credentialId,{min:16,max:1024});
 const expectedChallenge=decode(challenge,{min:43,max:43});
 if(expectedChallenge.length!==32)refuse('challenge-invalid');
 const clientBytes=decode(clientDataJSON,{min:16,max:4096});
 let client;
 try{client=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clientBytes));}
 catch{refuse('client-data-invalid');}
 if(!client||client.type!=='webauthn.create'||client.origin!==origin||
  (client.crossOrigin!==undefined&&client.crossOrigin!==false))
  refuse('client-data-invalid');
 if(!equal(decode(client.challenge,{min:43,max:43}),expectedChallenge))
  refuse('challenge-mismatch');
 const bytes=decode(attestationObject,{min:60,max:16384});
 const pos={i:0},statement=readCbor(bytes,pos);
 if(pos.i!==bytes.length||!(statement instanceof Map)||
  statement.size!==3||statement.get('fmt')!=='none'||
  !(statement.get('attStmt') instanceof Map)||statement.get('attStmt').size!==0)
  refuse('attestation-invalid');
 const auth=statement.get('authData');
 if(!(auth instanceof Uint8Array)||auth.length<56)refuse('authenticator-data-invalid');
 const rpHash=new Uint8Array(await subtle.digest('SHA-256',
  new TextEncoder().encode(rpId)));
 if(!equal(auth.slice(0,32),rpHash))refuse('rp-mismatch');
 const flags=auth[32];
 if((flags&0x01)===0||(flags&0x04)===0)refuse('user-verification-required');
 if((flags&0x40)===0)refuse('authenticator-data-invalid');
 const signCount=new DataView(auth.buffer,auth.byteOffset+33,4).getUint32(0,false);
 const credentialLength=(auth[53]<<8)|auth[54];
 if(credentialLength<16||credentialLength>1024||55+credentialLength>=auth.length)
  refuse('credential-invalid');
 const attestedId=auth.slice(55,55+credentialLength);
 if(!equal(attestedId,rawId))refuse('credential-mismatch');
 const cosePos={i:55+credentialLength};
 const cose=readCbor(auth,cosePos);
 // WebAuthn Level 3 permits a CBOR authenticator extension map after COSE.
 // Parse it only when ED is set, and always consume the entire authData.
 if((flags&0x80)!==0){
  const extensions=readCbor(auth,cosePos);
  if(!(extensions instanceof Map))refuse('extensions-invalid');
 }
 if(cosePos.i!==auth.length||!(cose instanceof Map)||
  cose.get(1)!==2||cose.get(3)!==-7||cose.get(-1)!==1||
  !(cose.get(-2) instanceof Uint8Array)||cose.get(-2).length!==32||
  !(cose.get(-3) instanceof Uint8Array)||cose.get(-3).length!==32)
  refuse('unsupported-credential-key');
 const prefix='3059301306072a8648ce3d020106082a8648ce3d03010703420004';
 const header=Uint8Array.from(prefix.match(/../g).map(x=>parseInt(x,16)));
 const publicKey=concat(concat(header,cose.get(-2)),cose.get(-3));
 // Hatchable V8 has SHA-256 digest but no ECDSA subtle.importKey.
 // Its node:crypto public-key verifier parses SPKI/PEM natively.
 try{
  const v=createVerifier('sha256');
  v.update(new Uint8Array([0]));
  // r=s=1 is well-formed DER, but not an attestation authorization:
  // this check only confirms the COSE public key can be parsed on-curve.
  v.verify(spkiPem(publicKey),'MAYCAQECAQE=','base64');
 }
 catch{refuse('unsupported-credential-key');}
 return Object.freeze({credentialId,publicKeySpki:encodeB64(publicKey),signCount});
}
