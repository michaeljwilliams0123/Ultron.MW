import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCouncilFleet, normalizeAppPrivateKey} from '../src/security/council-fleet-verification.mjs';
const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const env={GITHUB_APP_ID:'321',GITHUB_INSTALLATION_ID:'654',GITHUB_PRIVATE_KEY:'-----BEGIN FAKE KEY-----\\nabc\\n-----END FAKE KEY-----'};
const clock=()=>Date.parse('2026-11-10T02:00:00Z');
const issuer=async args=>{
 assert.deepEqual(args,{operation:'identity.read',repositoryId:repo.id,permissions:{metadata:'read'}});
 return {token:'NEVER-SERIALIZE-ME',installationId:654,repositoryId:repo.id,permissions:{metadata:'read'},expiresAt:'2026-11-10T02:15:00.000Z'};
};
const ok=async (_url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer NEVER-SERIALIZE-ME');return {ok:true,status:200,json:async()=>({total_count:1,repositories:[repo]})};};
test('missing App credentials hold without a fabricated 7/7 result',async()=>{
 const r=await verifyCouncilFleet({env:{},mintScopedToken:issuer,request:ok});
 assert.equal(r.status,'held');assert.equal(r.verifiedPrincipalCount,0);
 assert.equal(r.verifiedIndependentRoleCount,0);
 assert.equal(r.personasDefined,7);
});
test('actual one-installation GitHub readback verifies exactly one principal, never seven',async()=>{
 const r=await verifyCouncilFleet({env,mintScopedToken:issuer,request:ok,now:clock});
 assert.equal(r.status,'verified');assert.equal(r.verifiedPrincipalCount,1);
 assert.equal(r.verifiedIndependentRoleCount,0);
 assert.equal(r.roleBindings.length,7);
 assert.ok(r.roleBindings.every(x=>x.identityStatus==='logical-persona-only'));
 assert.equal(r.repository,repo.full_name);
 assert.equal(JSON.stringify(r).includes('NEVER-SERIALIZE-ME'),false);
 assert.equal(JSON.stringify(r).includes('FAKE KEY'),false);
});
test('mismatched or overbroad repository readbacks never verify a principal',async()=>{
 for(const invalid of [
  {total_count:1,repositories:[{...repo,id:999}]},
  {total_count:2,repositories:[repo,{id:222,full_name:'another/repo'}]},
  {total_count:1,repositories:[{...repo,full_name:'attacker/repo'}]},
 ]){
  const r=await verifyCouncilFleet({env,now:clock,mintScopedToken:issuer,request:async()=>({ok:true,status:200,json:async()=>invalid})});
  assert.equal(r.status,'held');assert.equal(r.verifiedPrincipalCount,0);
 }
});
test('scope mismatch, expired tokens and denied API calls fail closed',async()=>{
 const wrong=async()=>({...await issuer({operation:'identity.read',repositoryId:repo.id,permissions:{metadata:'read'}}),permissions:{contents:'write'}});
 assert.equal((await verifyCouncilFleet({env,now:clock,mintScopedToken:wrong,request:ok})).status,'held');
 const expired=async()=>({...await issuer({operation:'identity.read',repositoryId:repo.id,permissions:{metadata:'read'}}),expiresAt:'2026-11-09T00:00:00Z'});
 assert.equal((await verifyCouncilFleet({env,now:clock,mintScopedToken:expired,request:ok})).status,'held');
 const denied=async()=>({ok:false,status:403,headers:{get:()=>null}});
 const r=await verifyCouncilFleet({env,now:clock,mintScopedToken:issuer,request:denied});
 assert.equal(r.status,'held');assert.equal(r.reason,'github-readback-denied');
});
test('rate limits return a bounded held result instead of hammering GitHub',async()=>{
 let count=0;
 const limited=async()=>{count++;return {ok:false,status:429,headers:{get:k=>k==='retry-after'?'67':null}}};
 const r=await verifyCouncilFleet({env,now:clock,mintScopedToken:issuer,request:limited});
 assert.equal(count,1);assert.equal(r.status,'held');assert.equal(r.reason,'github-rate-limited');
 assert.equal(r.retryAfterSeconds,67);
});
test('private key normalization preserves actual newlines and converts escaped PEM newlines',()=>{
 assert.equal(normalizeAppPrivateKey('A\\nB'),'A\nB');
 assert.equal(normalizeAppPrivateKey('A\nB'),'A\nB');
 assert.equal(normalizeAppPrivateKey('A\r\nB'),'A\nB');
});
test('owner-only proof workflow cannot issue writes and does not run on untrusted PR events',async()=>{
 const {readFile}=await import('node:fs/promises');
 const yaml=await readFile(new URL('../.github/workflows/council-principal-proof.yml',import.meta.url),'utf8');
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/contents: read/);
 assert.match(yaml,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
 assert.match(yaml,/scripts\/verify-council-fleet\.mjs/);
 assert.doesNotMatch(yaml,/pull_request_target:|id-token: write|contents: write|actions: write/);
});

test('GitHub primary limit reset embargo takes precedence over a short default delay',async()=>{
 const reset=Math.floor(clock()/1000)+3605;
 const limited=async()=>({ok:false,status:403,headers:{get:k=>
  k==='x-ratelimit-remaining'?'0':k==='x-ratelimit-reset'?String(reset):null}});
 const r=await verifyCouncilFleet({env,now:clock,mintScopedToken:issuer,request:limited});
 assert.equal(r.status,'held');assert.equal(r.reason,'github-rate-limited');
 assert.equal(r.retryAfterSeconds,3605);
});
