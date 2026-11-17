/**
 * OpenAI Sign in with ChatGPT (SIWC) for owner-controlled OSS hosts.
 *
 * This is a public OAuth client using dynamic registration and PKCE, not
 * an OpenAI API project key or a ChatGPT session-token extractor.
 *
 * https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 */
import {randomBytes,createHash,createPublicKey,verify as cryptoVerify} from 'node:crypto';
const ISSUER='https://auth.openai.com';
const AUTH=ISSUER+'/api/accounts/authorize';
const DISCOVERY=ISSUER+'/.well-known/openid-configuration';
const TOKEN=ISSUER+'/api/accounts/oauth/token';
const RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CLIENT=/^oaiapp_[A-Za-z0-9._-]{3,200}$/;

function requireHost(hostId){
 if(typeof hostId!=='string'||!/^urn:uuid:[0-9a-f-]{36}$/.test(hostId))
  throw Error('siwc-invalid-host');
 return hostId;
}
function requireClient(clientId){
 if(!CLIENT.test(clientId||''))throw Error('siwc-invalid-client');
 return clientId;
}
export function createAuthorizationAttempt({
 hostId,port,clientId=null,agentName='Ultron.MW Council'
}={}){
 requireHost(hostId);
 if(!Number.isInteger(port)||port<1024||port>65535)
  throw Error('siwc-invalid-loopback-port');
 if(clientId!==null)requireClient(clientId);
 const state=randomBytes(32).toString('base64url');
 const nonce=randomBytes(32).toString('base64url');
 const verifier=randomBytes(48).toString('base64url');
 const redirectUri='http://127.0.0.1:'+port+'/auth/callback';
 const u=new URL(AUTH);
 const params=new URLSearchParams({
  client_id:clientId??'dynamic_agent_client',
  ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,
  scope:SCOPES,resource:RESOURCE,state,nonce,
  code_challenge_method:'S256',
  code_challenge:createHash('sha256').update(verifier).digest('base64url')
 });
 if(!clientId)params.set('agent_name_hint',agentName);
 u.search=params.toString();
 return Object.freeze({state,nonce,verifier,clientId,hostId,
  redirectUri,authorizationUrl:u.toString()});
}

export function validateAuthorizationCallback(callbackUrl,attempt){
 if(!attempt?.state||!attempt?.redirectUri)throw Error('siwc-no-pending-attempt');
 const actual=new URL(callbackUrl),expected=new URL(attempt.redirectUri);
 if(actual.origin!==expected.origin||actual.pathname!==expected.pathname||
    actual.searchParams.get('state')!==attempt.state||
    (actual.searchParams.getAll('state')).length!==1)
  throw Error('siwc-callback-state-or-origin-invalid');
 if(actual.searchParams.has('error'))throw Error('siwc-user-declined-consent');
 const code=actual.searchParams.get('code');
 if(!code||code.length>4096||actual.searchParams.getAll('code').length!==1)
  throw Error('siwc-authorization-code-missing');
 const received=actual.searchParams.get('client_id');
 const clientId=attempt.clientId??requireClient(received);
 if(attempt.clientId&&received&&received!==attempt.clientId)
  throw Error('siwc-client-registration-mismatch');
 return Object.freeze({code,clientId});
}
async function readJson(fetchImpl,url,init={}){
 const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(8000)});
 if(!res?.ok||res.status!==200)throw Error('siwc-provider-unavailable');
 return res.json();
}
const decode=x=>{
 if(typeof x!=='string'||x.length>20000)
  throw Error('siwc-invalid-jwt-part');
 return JSON.parse(Buffer.from(x,'base64url').toString('utf8'));
};

export async function validateIdToken(idToken,{
 clientId,nonce,fetchImpl=fetch,now=Date.now()
}={}){
 requireClient(clientId);
 if(typeof nonce!=='string'||nonce.length<4)
  throw Error('siwc-id-token-nonce-missing');
 const parts=typeof idToken==='string'?idToken.split('.'):[];
 if(parts.length!==3||parts.some(p=>!p))
  throw Error('siwc-id-token-format-invalid');
 const header=decode(parts[0]),claims=decode(parts[1]);
 if(header?.alg!=='RS256'||typeof header.kid!=='string'||
    header.kid.length<1||header.kid.length>200)
  throw Error('siwc-id-token-algorithm-invalid');
 const discovery=await readJson(fetchImpl,DISCOVERY);
 // Pin discovery and JWKS to the canonical OpenAI issuer.
 if(discovery?.issuer!==ISSUER||
    discovery?.jwks_uri!==ISSUER+'/.well-known/jwks.json')
  throw Error('siwc-id-token-provider-mismatch');
 const keyset=await readJson(fetchImpl,discovery.jwks_uri);
 const matches=keyset?.keys?.filter(k=>k.kid===header.kid&&
  k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'))||[];
 if(matches.length!==1)throw Error('siwc-id-token-key-invalid');
 const publicKey=createPublicKey({key:matches[0],format:'jwk'});
 const authentic=cryptoVerify('RSA-SHA256',
  Buffer.from(parts[0]+'.'+parts[1],'utf8'),
  publicKey,Buffer.from(parts[2],'base64url'));
 if(!authentic)throw Error('siwc-id-token-signature-invalid');
 const seconds=Math.floor(now/1000);
 const audience=typeof claims.aud==='string'?[claims.aud]:claims.aud;
 if(claims.iss!==ISSUER)throw Error('siwc-id-token-issuer-invalid');
 if(claims.nonce!==nonce)throw Error('siwc-id-token-nonce-invalid');
 // A single audience needs no azp; multiple audiences require the authorized party.
 if(!Array.isArray(audience)||audience.length===0||
    !audience.every(x=>typeof x==='string'&&x.length>0)||
    !audience.includes(clientId)||
    (audience.length>1&&claims.azp!==clientId)||
    (claims.azp!==undefined&&claims.azp!==clientId))
  throw Error('siwc-id-token-audience-invalid');
 if(typeof claims.sub!=='string'||!claims.sub)throw Error('siwc-id-token-subject-invalid');
 if(!Number.isInteger(claims.exp)||claims.exp<=seconds)
  throw Error('siwc-id-token-expiration-invalid');
 if(!Number.isInteger(claims.iat)||claims.iat>seconds+60)
  throw Error('siwc-id-token-issued-at-invalid');
 if(claims.nbf!==undefined&&claims.nbf>seconds+60)
  throw Error('siwc-id-token-not-before-invalid');
 return Object.freeze({sub:claims.sub,
  email:typeof claims.email==='string'?claims.email:null});
}

const requireTokenResponse=r=>{
 if(!r||r.token_type?.toLowerCase()!=='bearer'||
    typeof r.access_token!=='string'||r.access_token.length<20||
    typeof r.refresh_token!=='string'||r.refresh_token.length<10||
    r.access_token.startsWith('sk-')||
    !Number.isInteger(r.expires_in)||r.expires_in<=0||
    typeof r.scope!=='string')
  throw Error('siwc-oauth-token-invalid');
 return r;
};

export async function completeAuthorization({
 code,clientId,verifier,redirectUri,nonce,hostId,fetchImpl=fetch,now=Date.now()
}={}){
 requireClient(clientId);requireHost(hostId);
 if(typeof code!=='string'||!code||typeof verifier!=='string'||
    verifier.length<43||typeof redirectUri!=='string'||
    !/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(redirectUri))
  throw Error('siwc-authorization-invalid');
 const form=new URLSearchParams({
  grant_type:'authorization_code',client_id:clientId,code,
  code_verifier:verifier,redirect_uri:redirectUri,resource:RESOURCE
 });
 const response=requireTokenResponse(await readJson(fetchImpl,TOKEN,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:form.toString()
 }));
 const identity=await validateIdToken(response.id_token,
  {clientId,nonce,fetchImpl,now});
 return Object.freeze({kind:'chatgpt-plan-oauth',issuer:ISSUER,
  subject:identity.sub,email:identity.email,client_id:clientId,
  ext_agent_host_id:hostId,
  id_token:response.id_token,access_token:response.access_token,
  refresh_token:response.refresh_token,scope:response.scope,
  token_type:'Bearer',expires_in:response.expires_in,
  earliest_refresh_at:response.earliest_refresh_at??null,
  saved_at:new Date(now).toISOString()});
}

export async function refreshChatgptSession(credential,{
 fetchImpl=fetch,now=Date.now()
}={}){
 if(credential?.kind!=='chatgpt-plan-oauth'||
   credential?.issuer!==ISSUER||!credential?.subject||
   typeof credential?.refresh_token!=='string'||
   credential.refresh_token.length<10)
  throw Error('siwc-refresh-credential-invalid');
 requireClient(credential.client_id);
 requireHost(credential.ext_agent_host_id);
 const form=new URLSearchParams({
  grant_type:'refresh_token',client_id:credential.client_id,
  refresh_token:credential.refresh_token,resource:RESOURCE
 });
 const response=requireTokenResponse(await readJson(fetchImpl,TOKEN,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:form.toString()
 }));
 const scopes=response.scope.split(/\s+/);
 if(!scopes.includes('chatgpt.tokens.use.direct')||
    !scopes.includes('resource.invoke'))
  throw Error('siwc-refresh-plan-consent-revoked');
 return Object.freeze({...credential,
  access_token:response.access_token,refresh_token:response.refresh_token,
  scope:response.scope,token_type:'Bearer',expires_in:response.expires_in,
  earliest_refresh_at:response.earliest_refresh_at??null,
  saved_at:new Date(now).toISOString()});
}
