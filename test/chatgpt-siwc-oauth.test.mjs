import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,createHash} from 'node:crypto';
import {createAuthorizationAttempt,validateAuthorizationCallback,
 validateIdToken,completeAuthorization,refreshChatgptSession}
 from '../src/providers/chatgpt-siwc-auth.mjs';

const HOST='urn:uuid:3c5e7c3a-29ce-4cbd-bc0c-1b904962b14d';
const CLIENT='oaiapp_ultron_council_test';
const NOW=Date.parse('2026-11-15T19:30:00.000Z');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='test-key-v1';
const config={
 issuer:'https://auth.openai.com',
 jwks_uri:'https://auth.openai.com/.well-known/jwks.json',
 token_endpoint:'https://auth.openai.com/api/accounts/oauth/token'
};
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'}]};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function signedIdToken({aud=CLIENT,azp,nonce='verified-nonce',sub='owner-sub',exp=Math.floor(NOW/1000)+3600,iss='https://auth.openai.com'}={}){
 const header=b64({alg:'RS256',kid,typ:'JWT'});
 const body=b64({iss,aud,...(azp===undefined?{}:{azp}),nonce,sub,iat:Math.floor(NOW/1000)-10,exp,email:'test@example.com'});
 const signing=header+'.'+body;
 const s=createSign('RSA-SHA256');s.update(signing);s.end();
 return signing+'.'+s.sign(privateKey).toString('base64url');
}
const response=json=>({ok:true,status:200,json:async()=>json});
const fetchOidc=(token)=>async(url,req)=>{
 if(url==='https://auth.openai.com/.well-known/openid-configuration')return response(config);
 if(url===config.jwks_uri)return response(jwks);
 if(url===config.token_endpoint){
  assert.equal(req.method,'POST');
  const params=new URLSearchParams(req.body);
  assert.equal(params.get('client_id'),CLIENT);
  assert.equal(params.get('resource'),'https://api.openai.com/v1');
  if(params.get('grant_type')==='authorization_code'){
   assert.equal(params.get('code'),'authorization-code');
   assert.equal(params.get('redirect_uri'),'http://127.0.0.1:1455/auth/callback');
   assert.equal(params.get('code_verifier'),'a'.repeat(64));
  } else {
   assert.equal(params.get('grant_type'),'refresh_token');
   assert.equal(params.get('refresh_token'),'old-refresh-token');
  }
  return response(token);
 }
 throw Error('unexpected provider URL: '+url);
};
const token=(nonce='verified-nonce')=>({
 access_token:'generated-access-token-only-for-mock-response',
 refresh_token:'replacement-refresh-token-mock',
 id_token:signedIdToken({nonce}),
 token_type:'Bearer',expires_in:3600,
 scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
});

test('SIWC authorization registers a real OSS client with loopback callback, PKCE, nonce and state',()=>{
 const a=createAuthorizationAttempt({hostId:HOST,port:1455});
 const u=new URL(a.authorizationUrl);
 assert.equal(u.origin,'https://auth.openai.com');
 assert.equal(u.pathname,'/api/accounts/authorize');
 assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');
 assert.equal(u.searchParams.get('ext_agent_host_id'),HOST);
 assert.equal(u.searchParams.get('agent_name_hint'),'Ultron.MW Council');
 assert.equal(u.searchParams.get('response_type'),'code');
 assert.equal(u.searchParams.get('redirect_uri'),'http://127.0.0.1:1455/auth/callback');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('resource'),'https://api.openai.com/v1');
 assert.ok(u.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
 assert.ok(a.verifier.length>=43);
 assert.equal(u.searchParams.get('code_challenge'),
  createHash('sha256').update(a.verifier).digest('base64url'));
 assert.ok(a.state.length>=32&&a.nonce.length>=32);
 const next=createAuthorizationAttempt({hostId:HOST,port:1455});
 assert.notEqual(a.state,next.state);assert.notEqual(a.verifier,next.verifier);
});

test('callback rejects missing nonce state, foreign redirect, mismatched account, or declined consent',()=>{
 const attempt=createAuthorizationAttempt({hostId:HOST,port:1455});
 const uri=attempt.redirectUri+'?code=authorization-code&state='+attempt.state+'&client_id='+CLIENT;
 assert.deepEqual(validateAuthorizationCallback(uri,attempt),{code:'authorization-code',clientId:CLIENT});
 for(const wrong of [
  uri.replace(attempt.state,'spoofed'),
  uri.replace(CLIENT,'dynamic_agent_client'),
  uri.replace('127.0.0.1','localhost'),
  attempt.redirectUri+'?error=access_denied&state='+attempt.state
 ])assert.throws(()=>validateAuthorizationCallback(wrong,attempt));
 const returning=createAuthorizationAttempt({hostId:HOST,port:1455,clientId:CLIENT});
 assert.equal(new URL(returning.authorizationUrl).searchParams.get('client_id'),CLIENT);
 assert.equal(new URL(returning.authorizationUrl).searchParams.has('agent_name_hint'),false);
 assert.deepEqual(validateAuthorizationCallback(
  returning.redirectUri+'?code=authorization-code&state='+returning.state,returning),
  {code:'authorization-code',clientId:CLIENT});
});

test('cryptographically validates OpenAI OIDC JWT signature, issuer, audience, nonce and expiration',async()=>{
 const valid=await validateIdToken(signedIdToken(),{
  clientId:CLIENT,nonce:'verified-nonce',fetchImpl:fetchOidc({}),now:NOW
 });
 assert.equal(valid.sub,'owner-sub');
 assert.equal(valid.email,'test@example.com');
 for(const bad of [
  signedIdToken({aud:'wrong'}),
  signedIdToken({nonce:'bad'}),
  signedIdToken({exp:Math.floor(NOW/1000)-10}),
  signedIdToken({iss:'https://attacker.example'}),
  signedIdToken().slice(0,-4)+'abcd'
 ]){
  await assert.rejects(()=>validateIdToken(bad,{clientId:CLIENT,nonce:'verified-nonce',
   fetchImpl:fetchOidc({}),now:NOW}));
 }
});

test('OpenAI singleton audience array validates without optional azp, multi-audience requires matching azp',async()=>{
 const opts={clientId:CLIENT,nonce:'verified-nonce',fetchImpl:fetchOidc({}),now:NOW};
 const singleton=await validateIdToken(signedIdToken({aud:[CLIENT]}),opts);
 assert.equal(singleton.sub,'owner-sub');
 const multi=await validateIdToken(signedIdToken({aud:[CLIENT,'secondary-client'],azp:CLIENT}),opts);
 assert.equal(multi.sub,'owner-sub');
 await assert.rejects(()=>validateIdToken(signedIdToken({aud:[CLIENT,'secondary-client']}),opts),
  {message:'siwc-id-token-audience-invalid'});
 await assert.rejects(()=>validateIdToken(signedIdToken({aud:[CLIENT,'secondary-client'],azp:'wrong'}),opts),
  {message:'siwc-id-token-audience-invalid'});
 await assert.rejects(()=>validateIdToken(signedIdToken({aud:[CLIENT],azp:'wrong'}),opts),
  {message:'siwc-id-token-audience-invalid'});
 const issued=await completeAuthorization({
  code:'authorization-code',clientId:CLIENT,verifier:'a'.repeat(64),
  redirectUri:'http://127.0.0.1:1455/auth/callback',
  nonce:'verified-nonce',hostId:HOST,now:NOW,
  fetchImpl:fetchOidc({...token(),id_token:signedIdToken({aud:[CLIENT]})})
 });
 assert.equal(issued.subject,'owner-sub');
});

test('verified OAuth exchange returns scoped credential, never API billing key',async()=>{
 const data=await completeAuthorization({
  code:'authorization-code',clientId:CLIENT,verifier:'a'.repeat(64),
  redirectUri:'http://127.0.0.1:1455/auth/callback',
  nonce:'verified-nonce',hostId:HOST,now:NOW,fetchImpl:fetchOidc(token())
 });
 assert.equal(data.kind,'chatgpt-plan-oauth');
 assert.equal(data.client_id,CLIENT);assert.equal(data.subject,'owner-sub');
 assert.equal(data.issuer,'https://auth.openai.com');
 assert.equal(data.ext_agent_host_id,HOST);
 assert.ok(data.scope.includes('chatgpt.tokens.use.direct'));
 assert.equal(data.refresh_token,'replacement-refresh-token-mock');
 assert.equal(data.expires_in,3600);
 assert.equal(data.saved_at,'2026-11-15T19:30:00.000Z');
});

test('OAuth without plan permission can sign in but cannot be used for model inference',async()=>{
 const t={...token(),scope:'openid profile email offline_access'};
 const data=await completeAuthorization({code:'authorization-code',clientId:CLIENT,
  verifier:'a'.repeat(64),redirectUri:'http://127.0.0.1:1455/auth/callback',
  nonce:'verified-nonce',hostId:HOST,now:NOW,fetchImpl:fetchOidc(t)});
 assert.equal(data.scope.includes('chatgpt.tokens.use.direct'),false);
});

test('refresh rotates access and refresh token only under the same client and verified plan scopes',async()=>{
 const prior={kind:'chatgpt-plan-oauth',client_id:CLIENT,issuer:'https://auth.openai.com',
  subject:'owner-sub',scope:token().scope,refresh_token:'old-refresh-token',
  access_token:'previous-access-token-that-must-not-survive',
  ext_agent_host_id:HOST,saved_at:new Date(NOW-3800000).toISOString(),expires_in:3600};
 const result=await refreshChatgptSession(prior,{now:NOW,fetchImpl:fetchOidc(token())});
 assert.equal(result.client_id,CLIENT);
 assert.equal(result.subject,'owner-sub');
 assert.equal(result.access_token,token().access_token);
 assert.equal(result.refresh_token,token().refresh_token);
 assert.equal(result.saved_at,new Date(NOW).toISOString());
 const notAuthorized=fetchOidc({...token(),scope:'openid profile'});
 await assert.rejects(()=>refreshChatgptSession(prior,{now:NOW,fetchImpl:notAuthorized}));
});
