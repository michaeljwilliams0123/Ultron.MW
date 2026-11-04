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
  const cryptoKey=await crypto.subtle.importKey('jwk',{
   kty:'RSA',n:key.n,e:key.e,alg:'RS256',ext:true,key_ops:['verify']
  },{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,
   b64url(parts[2]),bytes(parts[0]+'.'+parts[1]));
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
