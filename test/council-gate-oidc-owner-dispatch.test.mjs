import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {verifyCouncilGateOidc, councilOidcAudience}
 from '../cloud/hatchable/lib/council-oidc.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const WORKFLOW=REPO+'/.github/workflows/council-required-status.yml@refs/heads/main';
const TIME=Date.parse('2026-11-17T18:00:00Z');
const BODY=JSON.stringify({op:'open',limit:1});
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'council-gate-owner-dispatch-regression',alg:'RS256'};
function claims(override={}){
 return{
  iss:'https://token.actions.githubusercontent.com',
  aud:councilOidcAudience(BODY),
  repository_visibility:'public',
  repository:REPO,repository_id:'1424939667',
  repository_owner:'michaeljwilliams0123',repository_owner_id:'308995719',
  sub:'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main',
  actor:'michaeljwilliams0123',actor_id:'308995719',
  workflow_ref:WORKFLOW,ref:'refs/heads/main',
  event_name:'workflow_dispatch',sha:'a'.repeat(40),
  iat:Math.floor(TIME/1000)-6,exp:Math.floor(TIME/1000)+180,
  ...override
 };
}
const signed=(c)=>{
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const value=enc({typ:'JWT',alg:'RS256',kid:jwk.kid})+'.'+enc(c);
 return value+'.'+sign('RSA-SHA256',Buffer.from(value),privateKey).toString('base64url');
};
const options={rawBody:BODY,now:()=>TIME,
 fetchJwks:async()=>({ok:true,json:async()=>({keys:[jwk]})})};
const verify=(change={},opts={})=>
 verifyCouncilGateOidc({...options,token:signed(claims(change)),...opts});

test('trusted owner workflow_dispatch recheck can prove its signed GitHub identity to ledger',async()=>{
 const proof=await verify();
 assert.equal(proof.actor,'michaeljwilliams0123');
 assert.equal(proof.event,'workflow_dispatch');
 assert.equal(proof.source,'trusted-council-gate');
});
test('existing pull_request_target trusted Council gate remains accepted',async()=>{
 const proof=await verify({event_name:'pull_request_target'});
 assert.equal(proof.event,'pull_request_target');
 assert.equal(proof.source,'trusted-council-gate');
});
test('workflow_dispatch cannot be claimed by Ultron alias or any non-owner actor',async()=>{
 for(const actor of [
  {actor:'michaeljwilliams0123ultron',actor_id:'354634860'},
  {actor:'github-actions[bot]',actor_id:'41898282'},
  {actor:'michaeljwilliams0123',actor_id:'354634860'}
 ]){
  await assert.rejects(verify(actor),/council-oidc-untrusted/);
 }
});
test('unrelated workflow events never become valid Council gate ledger authority',async()=>{
 for(const event_name of ['issue_comment','workflow_run','pull_request','push','repository_dispatch']){
  await assert.rejects(verify({event_name}),/council-oidc-untrusted/);
 }
});
test('the GitHub Actions workflow identity and repo binding remain exact',async()=>{
 for(const patch of [
  {workflow_ref:REPO+'/.github/workflows/council-debate.yml@refs/heads/main'},
  {workflow_ref:WORKFLOW.replace('main','feature')},
  {ref:'refs/heads/feature'},
  {repository:'Ultron-MW/Ultron.MW'},
  {repository_id:'42'},
  {sub:'repo:untrusted:ref:refs/heads/main'},
  {repository_visibility:'private'},
  {sha:'not-a-commit-sha'}
 ]){
  await assert.rejects(verify(patch),/council-oidc-untrusted/);
 }
});
test('raw-body digest, expiry and signature are not bypassed by new event support',async()=>{
 await assert.rejects(verify({}, {rawBody:BODY+' '}),/council-oidc-untrusted/);
 await assert.rejects(verify({exp:Math.floor(TIME/1000)-1}),/council-oidc-untrusted/);
 const valid=signed(claims());
 const corrupted=valid.slice(0,-4)+'AAAA';
 await assert.rejects(
  verifyCouncilGateOidc({...options,token:corrupted}),
  /council-oidc-untrusted/
 );
});
