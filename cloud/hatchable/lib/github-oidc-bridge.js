import {createVerify} from 'node:crypto';
/** Credentialless, body-bound GitHub Actions identity verification.
 * Trust only GitHub's pinned JWKS endpoint, validated RSA signature, and
 * exact main-branch workflow identity. Never accept an unverified JWT.
 */
const ISS='https://token.actions.githubusercontent.com';
const JWKS=ISS+'/.well-known/jwks';
const REPO='michaeljwilliams0123/Ultron.MW';
const REF='refs/heads/main';
const WORKFLOW=REPO+'/.github/workflows/hf-oidc-bridge.yml@'+REF;
const SUBJECT='repo:'+REPO+':ref:'+REF;
const AUD_PREFIX='ultron.hf-oidc.v1:sha256:';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
const REPO_ID='1424939667';
function deny(){throw Error('untrusted-oidc');}
function bytes(s){
 if(typeof s!=='string')deny();
 return new TextEncoder().encode(s);
}
function hex(buffer){
 return Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
}
function b64url(value){
 if(typeof value!=='string'||!value||value.length>10000||!/^[A-Za-z0-9_-]+$/.test(value))deny();
 let binary;
 try{binary=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));}
 catch{deny();}
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function decode(value){
 try{return JSON.parse(new TextDecoder().decode(b64url(value)));}
 catch{deny();}
}
// Hatchable's secure isolate supports node:crypto RSA verification rather
// than WebCrypto RSA importKey. Build an SPKI PEM from a trusted pinned JWKS key.
function concat(...parts){
 const chunks=parts.map(p=>p instanceof Uint8Array?p:Uint8Array.from(p));
 const out=new Uint8Array(chunks.reduce((n,p)=>n+p.length,0));
 let at=0;for(const p of chunks){out.set(p,at);at+=p.length;}return out;
}
function asnLength(n){
 if(n<128)return Uint8Array.of(n);
 if(n<256)return Uint8Array.of(0x81,n);
 if(n<65536)return Uint8Array.of(0x82,n>>8,n&255);
 deny();
}
function der(tag,data){return concat([tag],asnLength(data.length),data);}
function integer(value){
 let v=b64url(value);
 while(v.length>1&&v[0]===0)v=v.slice(1);
 return der(0x02,v[0]>=128?concat([0],v):v);
}
function publicPem(key){
 const rsa=der(0x30,concat(integer(key.n),integer(key.e)));
 const algorithm=Uint8Array.from([
  0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,
  0x01,0x01,0x01,0x05,0x00
 ]);
 const subject=der(0x30,concat(algorithm,der(0x03,concat([0],rsa))));
 const enc=btoa(Array.from(subject,x=>String.fromCharCode(x)).join(''));
 return '-----BEGIN PUBLIC KEY-----\n'+
  enc.match(/.{1,64}/g).join('\n')+
  '\n-----END PUBLIC KEY-----';
}
export async function oidcAudience(raw){
 if(typeof raw!=='string'||raw.length<2||raw.length>2048)deny();
 const sha=await crypto.subtle.digest('SHA-256',bytes(raw));
 return AUD_PREFIX+hex(sha);
}
export function validateOidcBody(value){
 if(!value||typeof value!=='object'||Array.isArray(value))deny();
 const fields=Object.keys(value);
 if(fields.length!==4||fields.some(k=>!['schema','runId','runAttempt','deliveryId'].includes(k))||
  value.schema!=='ultron.hf-oidc-run.v1'||
  !Number.isSafeInteger(value.runId)||value.runId<=0||
  !Number.isSafeInteger(value.runAttempt)||value.runAttempt<=0||value.runAttempt>20||
  typeof value.deliveryId!=='string'||!UUID.test(value.deliveryId))deny();
 return Object.freeze({runId:value.runId,runAttempt:value.runAttempt,
  deliveryId:value.deliveryId.toLowerCase()});
}
export async function verifyGitHubOidc({
 token,rawBody,fetchJwks=fetch,now=Date.now
}={}){
 if(typeof token!=='string'||token.length>8000||token.length<250||typeof rawBody!=='string')deny();
 const parts=token.split('.');
 if(parts.length!==3)deny();
 const head=decode(parts[0]),claims=decode(parts[1]);
 if(!head||head.alg!=='RS256'||typeof head.kid!=='string'||
   !/^[\w-]{8,120}$/.test(head.kid)||!claims||typeof claims!=='object')deny();
 const audience=await oidcAudience(rawBody);
 const epoch=Math.floor(now()/1000);
 if(claims.iss!==ISS||claims.aud!==audience||
  claims.sub!==SUBJECT||claims.repository!==REPO||claims.repository_id!==REPO_ID||
  claims.repository_owner!=='michaeljwilliams0123'||
  claims.repository_visibility!=='public'||
  claims.actor!=='michaeljwilliams0123'||
  claims.workflow_ref!==WORKFLOW||
  claims.ref!==REF||!SHA.test(claims.sha||'')||
  !['workflow_run','workflow_dispatch'].includes(claims.event_name)||
  !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
  claims.exp<epoch||claims.exp>epoch+600||
  claims.iat>epoch+45||claims.iat<epoch-360||
  claims.exp<=claims.iat||claims.exp-claims.iat>600||
  claims.nbf!=null&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>epoch+45))
  deny();
 let keys;
 try{
  const response=await fetchJwks(JWKS,{
   method:'GET',headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(5000)});
  if(!response.ok)deny();
  keys=(await response.json()).keys;
 }catch{deny();}
 if(!Array.isArray(keys)||keys.length>30)deny();
 const key=keys.find(k=>k?.kid===head.kid&&k.kty==='RSA'&&
   k.alg==='RS256'&&typeof k.n==='string'&&typeof k.e==='string');
 if(!key)deny();
 let valid=false;
 try{
  const verifier=createVerify('RSA-SHA256');
  verifier.update(parts[0]+'.'+parts[1]);
  verifier.end();
  valid=verifier.verify(publicPem(key),b64url(parts[2]));
 }catch{deny();}
 if(!valid)deny();
 const body=decodeRaw(rawBody);
 const parsed=validateOidcBody(body);
 const payloadSha256=hex(await crypto.subtle.digest('SHA-256',bytes(rawBody)));
 return Object.freeze({...parsed,payloadSha256,actor:claims.actor,
  oidcWorkflowSha:claims.sha,oidcEvent:claims.event_name});
}
function decodeRaw(raw){
 try{return JSON.parse(raw);}
 catch{deny();}
}
