import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyCouncilWorkerOidc,councilOidcAudience}
 from '../cloud/hatchable/lib/council-oidc.js';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'worker-issue-test-key',alg:'RS256'};
const clock=Date.parse('2026-11-09T12:00:00Z');
const body=JSON.stringify({op:'reserve',caseDigest:'a'.repeat(64)});
const data=()=>({
 iss:'https://token.actions.githubusercontent.com',
 aud:councilOidcAudience(body),repository_visibility:'public',
 repository:'Ultron-MW/Ultron.MW',repository_id:'1424939667',
 repository_owner:'Ultron-MW',repository_owner_id:'354776009',
 sub:'repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:refs/heads/main',
 actor:'michaeljwilliams0123',actor_id:'308995719',
 workflow_ref:'Ultron-MW/Ultron.MW/.github/workflows/council-worker.yml@refs/heads/main',
 ref:'refs/heads/main',event_name:'issues',sha:'a'.repeat(40),
 iat:Math.floor(clock/1000)-5,exp:Math.floor(clock/1000)+120
});
const token=claims=>{
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const msg=encode({typ:'JWT',alg:'RS256',kid:jwk.kid})+'.'+encode(claims);
 return msg+'.'+sign('RSA-SHA256',Buffer.from(msg),privateKey).toString('base64url');
};
const options={rawBody:body,now:()=>clock,
 fetchJwks:async()=>({ok:true,json:async()=>({keys:[jwk]})})};
test('Council browser worker accepts signed owner issue event from pinned workflow',async()=>{
 const out=await verifyCouncilWorkerOidc({...options,token:token(data())});
 assert.equal(out.actor,'michaeljwilliams0123');
 assert.equal(out.event,'issues');
 assert.equal(out.source,'council-worker');
});
test('Council issue OIDC still rejects bot actors, other workflow and forged audience',async()=>{
 for(const change of [
  {actor:'github-actions[bot]'},
  {event_name:'pull_request'},
  {workflow_ref:'Ultron-MW/Ultron.MW/.github/workflows/untrusted.yml@refs/heads/main'},
  {repository_visibility:'private'},
  {ref:'refs/heads/untrusted'}
 ]){
  await assert.rejects(
   verifyCouncilWorkerOidc({...options,token:token({...data(),...change})}),
   /council-oidc-untrusted/);
 }
 await assert.rejects(verifyCouncilWorkerOidc({...options,rawBody:'different',token:token(data())}),
  /council-oidc-untrusted/);
});
