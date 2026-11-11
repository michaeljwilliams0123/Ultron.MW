import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyGitHubOidc,validateOidcBody,oidcAudience} from '../cloud/hatchable/lib/github-oidc-bridge.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),alg:'RS256',kid:'fixed-test-github-key',use:'sig'};
const base64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
const sha='a'.repeat(40);
const initial={schema:'ultron.hf-oidc-run.v1',runId:41775191071,runAttempt:1,deliveryId:'00000000-0000-4000-8000-000000000777'};
const claims=(aud,changes={})=>{
 const now=1890000000;
 return {
  iss:'https://token.actions.githubusercontent.com',
  aud,
  sub:'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main',
  repository:'michaeljwilliams0123/Ultron.MW',
  repository_id:'1424939667',repository_visibility:'public',
  repository_owner:'michaeljwilliams0123',repository_owner_id:'308995719',
  actor:'michaeljwilliams0123',actor_id:'308995719',
  ref:'refs/heads/main',sha,
  workflow_ref:'michaeljwilliams0123/Ultron.MW/.github/workflows/hf-oidc-bridge.yml@refs/heads/main',
  event_name:'workflow_dispatch',
  iat:now,nbf:now-1,exp:now+240,
  ...changes
 };
};
function sign(payload,kid=jwk.kid){
 const prefix=base64({alg:'RS256',typ:'JWT',kid})+'.'+base64(payload);
 const signer=createSign('RSA-SHA256');signer.update(prefix);signer.end();
 return prefix+'.'+signer.sign(privateKey).toString('base64url');
}
const now=()=>1890000000*1000;
const jwks=async url=>{
 assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
 return {ok:true,json:async()=>({keys:[jwk]})};
};
const verify=async(body=initial,payload=null,opts={})=>{
 const raw=JSON.stringify(body);
 const token=sign(payload||claims(await oidcAudience(raw)));
 return verifyGitHubOidc({token,rawBody:raw,fetchJwks:jwks,now,...opts});
};
test('OIDC-01: valid RSA GitHub JWT, fixed repo/workflow/branch, bound body grants read-only receipt ingress',async()=>{
 const good=await verify();
 assert.equal(good.runId,initial.runId);
 assert.equal(good.runAttempt,1);
 assert.equal(good.deliveryId,initial.deliveryId);
 assert.equal(good.payloadSha256,createHash('sha256').update(JSON.stringify(initial)).digest('hex'));
 assert.equal(good.actor,'michaeljwilliams0123');
});
test('OIDC-02: token audience is a SHA-256 commitment to the exact raw request body',async()=>{
 const raw=JSON.stringify(initial);
 const audience=await oidcAudience(raw);
 assert.ok(audience.includes(createHash('sha256').update(raw).digest('hex')));
 await assert.rejects(()=>verify({...initial,runId:41775191072},claims(audience)),/untrusted-oidc/);
});
test('OIDC-03: fake signature, wrong key id, wrong issuer and expired token fail closed',async()=>{
 const raw=JSON.stringify(initial);
 const aud=await oidcAudience(raw);
 const data=claims(aud);
 for(const wrong of [
  sign({...data,iss:'https://attacker.example'}),
  sign({...data,exp:data.iat-1}),
  sign({...data,iat:data.iat-700}),
  sign({...data,aud:'wrong'}),
  sign(data,'wrong-kid'),
  sign(data).slice(0,-5)+'ABC12'
 ])await assert.rejects(()=>verifyGitHubOidc({token:wrong,rawBody:raw,fetchJwks:jwks,now}),/untrusted-oidc/);
});
test('OIDC-04: no other workflow, event, private/forked repo, actor or permission path can send',async()=>{
 const raw=JSON.stringify(initial),aud=await oidcAudience(raw);
 const bad=[
  {repository:'fork/Ultron.MW'},{repository_id:'5'},
  {repository_visibility:'private'},{repository_owner:'attacker'},
  {actor:'github-actions[bot]'},{ref:'refs/pull/4/head'},
  {event_name:'pull_request'},{workflow_ref:'michaeljwilliams0123/Ultron.MW/.github/workflows/verify.yml@refs/heads/main'},
  {sub:'repo:michaeljwilliams0123/Ultron.MW:pull_request'},
  {sub:'repo:michaeljwilliams0123/Ultron.MW:ref:refs/heads/main'}
 ];
 for(const d of bad)await assert.rejects(()=>verify(initial,claims(aud,d)),/untrusted-oidc/);
});
test('OIDC-05: no unknown payload fields, malformed run ids, oversized or replay-modified identifiers',()=>{
 assert.equal(validateOidcBody(initial).runId,41775191071);
 for(const body of [
  {...initial,objective:'merge'}, {...initial,runId:-1},
  {...initial,runAttempt:0},{...initial,deliveryId:'__not-a-uuid__'},
  {schema:'wrong',runId:initial.runId,runAttempt:1,deliveryId:initial.deliveryId},
  null, [],'hello',
 ])assert.throws(()=>validateOidcBody(body),/untrusted-oidc/);
});
test('OIDC-06: bridge workflow is retired; no lane mints the bridge audience; endpoint stays fail-closed',async()=>{
 const {readdirSync}=await import('node:fs');
 const api=readFileSync('cloud/hatchable/api/brain/hf-oidc-event.js','utf8');
 assert.match(api,/access='public'/);
 assert.match(api,/verifyGitHubOidc/);
 assert.match(api,/validateGithubWorkflowPayload/);
 // hf-oidc-bridge.yml never succeeded (Hatchable's unauthenticated readback
 // returned 503); the owner approved retiring it. The trust entry is removed
 // in the follow-up Hatchable release; until then nothing can mint for it.
 const files=readdirSync('.github/workflows');
 assert.equal(files.includes('hf-oidc-bridge.yml'),false);
 for(const name of files)
  assert.doesNotMatch(readFileSync('.github/workflows/'+name,'utf8'),/hf-oidc-publish\.mjs/,name);
});
