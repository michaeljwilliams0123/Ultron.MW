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
 let key;
 try{key=await subtle.importKey('spki',decode(publicKeySpki,{min:80,max:1024}),
  {name:'ECDSA',namedCurve:'P-256'},false,['verify']);}
 catch{refuse('public-key-invalid');}
 const clientHash=new Uint8Array(await subtle.digest('SHA-256',clientBytes));
 let verified=false;
 try{verified=await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,
  derToRaw(decode(signature,{min:80,max:128})),concat(auth,clientHash));}
 catch{refuse('signature-invalid');}
 if(!verified)refuse('signature-invalid');
 return {credentialId,signCount};
}
