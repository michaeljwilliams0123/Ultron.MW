import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNCIL_APP_ROLES,authenticateCouncilAppActor} from '../src/council-app-identities.mjs';
import {createSharedCouncilCase} from '../src/council-shared-collaboration.mjs';
import {buildCouncilExternalIntent,runCouncilExternalIntent,
  COUNCIL_EXTERNAL_CAPABILITIES} from '../src/council-external-authority.mjs';
const sha='a'.repeat(40), peer='b'.repeat(40);
const repo='michaeljwilliams0123/Ultron.MW';
const shared=createSharedCouncilCase({
 repository:repo,objectiveId:'continuum-external-authority-2026',
 taskFingerprint:'c'.repeat(64),sourceSha:sha,
 ownerIntent:'Seven SME agents: public web and direct Mahoraga GitHub read access',
 lifecycle:'plan',blockedBy:['#183','#184'],
 evidenceRefs:['https://github.com/michaeljwilliams0123/Ultron.MW/pull/208'],
 constraints:{maxPaidCents:0,independentReviewRequired:true}
});
const githubPermissions={metadata:'read',contents:'write',issues:'write',
  pull_requests:'write',checks:'read',actions:'write'};
async function actor(role){
 return authenticateCouncilAppActor({
  role,profile:'collaborative-sme',sourceSha:sha,installationToken:'test-ephemeral-'+role,
  githubProbe:async()=>({
   source:'github-installations-api',app_slug:'ultron-mw-'+role.toLowerCase(),
   app_id:900+COUNCIL_APP_ROLES.indexOf(role),id:700+COUNCIL_APP_ROLES.indexOf(role),
   repositories:[repo],permissions:githubPermissions,suspended_at:null
  })
 });
}
test('RED C04 external: all seven roles get identical web and Mahoraga options and one case SHA',()=>{
 assert.deepEqual(COUNCIL_EXTERNAL_CAPABILITIES,[
  'web.open','mahoraga.repo.inspect','mahoraga.task.prepare'
 ]);
 for(const role of COUNCIL_APP_ROLES){
  const plan=buildCouncilExternalIntent({role,shared,capability:'web.open',
   target:{url:'https://docs.github.com/en/apps'},attempt:1,maxPaidCents:0});
  assert.equal(plan.caseSha,shared.caseSha);
  assert.equal(plan.role,role);
  assert.equal(plan.capability,'web.open');
  assert.equal(plan.method,'GET');
  assert.equal(plan.allowRedirects,false);
  assert.equal(plan.maxPaidCents,0);
  assert.equal(plan.externalContentTrusted,false);
  assert.match(plan.fingerprint,/^[a-f0-9]{64}$/);
 }
});
test('RED C04 external: URL input validation prohibits SSRF, credentials and nonpublic schemes',()=>{
 for(const url of ['http://example.com','file:///etc/passwd','https://localhost',
  'https://127.0.0.1','https://[::1]','https://169.254.169.254/latest/meta-data',
  'https://metadata.google.internal','https://user:pass@example.org',
  'https://192.168.1.7/path','https://internal.localhost','https://foo.local',
  'https://10.0.0.2','https://[fc00::1]','https://example.com:8443',
  'https://example.com/path#fragment']){
  assert.throws(()=>buildCouncilExternalIntent({
   role:'Builder',shared,capability:'web.open',target:{url},
   attempt:1,maxPaidCents:0
  }),/external-(url|target)-invalid/,url);
 }
});
test('RED C04 external: Mahoraga access uses exact repo and commit, not an Ultron token or arbitrary host',()=>{
 const plan=buildCouncilExternalIntent({role:'Builder',shared,
  capability:'mahoraga.repo.inspect',
  target:{repository:'michaeljwilliams0123/mahoraga',
   sourceSha:peer,path:'src/task-relay-contract.mjs'},
  attempt:1,maxPaidCents:0});
 assert.equal(plan.target.repository,'michaeljwilliams0123/mahoraga');
 assert.equal(plan.target.sourceSha,peer);
 for(const target of [
  {repository:repo,sourceSha:peer,path:'src/task-relay-contract.mjs'},
  {repository:'michaeljwilliams0123/mahoraga',sourceSha:'main',path:'src/task-relay-contract.mjs'},
  {repository:'michaeljwilliams0123/mahoraga',sourceSha:peer,path:'../.env'},
  {repository:'michaeljwilliams0123/mahoraga',sourceSha:peer,path:'.github/workflows/verify.yml'}
 ]){
  assert.throws(()=>buildCouncilExternalIntent({role:'Builder',shared,
   capability:'mahoraga.repo.inspect',target,attempt:1,maxPaidCents:0}),/external-target-invalid/);
 }
});
test('RED C04 external: zero-price and immutable task-fingerprint admission',()=>{
 const common={role:'Builder',shared,capability:'web.open',
  target:{url:'https://example.com'},attempt:1,maxPaidCents:0};
 const a=buildCouncilExternalIntent(common);
 const b=buildCouncilExternalIntent(common);
 assert.equal(a.fingerprint,b.fingerprint);
 for(const altered of [{maxPaidCents:1},{attempt:0},{attempt:4},{role:'Director'}]){
  assert.throws(()=>buildCouncilExternalIntent({...common,...altered}),/external-(plan|role)-invalid/);
 }
 assert.notEqual(a.fingerprint,buildCouncilExternalIntent({
  ...common,target:{url:'https://example.com/updated'}}).fingerprint);
});
test('RED C04 external: no configured trusted executor means no live work, no guessed receipt',async()=>{
 const plan=buildCouncilExternalIntent({role:'Builder',shared,capability:'web.open',
  target:{url:'https://www.wikipedia.org/'},attempt:1,maxPaidCents:0});
 await assert.rejects(runCouncilExternalIntent({plan,actor:await actor('Builder')}),
  /external-executor-unavailable/);
 await assert.rejects(runCouncilExternalIntent({plan,actor:{role:'Builder'},
  transport:{webRead:async()=>({status:200,text:'fake'})}}),
  /external-identity-unverified/);
});
test('RED C04 external: trusted web observation requires explicit safe egress and bounded response',async()=>{
 const plan=buildCouncilExternalIntent({role:'Skeptic',shared,capability:'web.open',
  target:{url:'https://www.wikipedia.org/'},attempt:1,maxPaidCents:0});
 const who=await actor('Skeptic');
 const transport={webRead:async({url,method,redirect,maxBytes})=>{
  assert.equal(url,'https://www.wikipedia.org/');
  assert.equal(method,'GET');
  assert.equal(redirect,'manual');
  assert.ok(maxBytes<=65536);
  return {status:200,finalUrl:url,contentType:'text/html',
    body:'<html>Reference only</html>',egressVerified:true,redirected:false};
 }};
 const receipt=await runCouncilExternalIntent({plan,actor:who,transport});
 assert.equal(receipt.observed,true);
 assert.equal(receipt.verifiedExternalExecution,false);
 assert.equal(receipt.pageContentTrusted,false);
 assert.equal(receipt.role,'Skeptic');
 const bad={webRead:async()=>({status:200,finalUrl:'http://localhost',
  contentType:'text/html',body:'invalid',egressVerified:false,redirected:true})};
 await assert.rejects(runCouncilExternalIntent({plan,actor:who,transport:bad}),
  /external-observation-invalid/);
});
test('RED C04 external: Mahoraga inspection requires separate installation authorization and exact SHA',async()=>{
 const plan=buildCouncilExternalIntent({role:'Sentinel',shared,
  capability:'mahoraga.repo.inspect',
  target:{repository:'michaeljwilliams0123/mahoraga',
   sourceSha:peer,path:'src/task-relay-contract.mjs'},attempt:1,maxPaidCents:0});
 const who=await actor('Sentinel');
 const authorized={
  githubRead:async(args)=>{
   assert.equal(args.repository,'michaeljwilliams0123/mahoraga');
   assert.equal(args.sourceSha,peer);
   return {status:200,repository:args.repository,sourceSha:args.sourceSha,
    path:args.path,text:'export const RELAY_PROTOCOL_VERSION = "3.0.1";',
    installationVerified:true,repositoryAccessVerified:true};
  }
 };
 const result=await runCouncilExternalIntent({plan,actor:who,transport:authorized});
 assert.equal(result.observed,true);
 assert.equal(result.verifiedExternalExecution,false);
 assert.equal(result.sourceSha,peer);
 await assert.rejects(runCouncilExternalIntent({plan,actor:who,transport:{
  githubRead:async()=>({status:200,repository:'michaeljwilliams0123/mahoraga',
   sourceSha:peer,path:'src/task-relay-contract.mjs',text:'spoofed',
   installationVerified:false,repositoryAccessVerified:false})
 }}),/external-observation-invalid/);
});
test('RED C04 external: Mahoraga task prepare is not a blind write or independent delivery',async()=>{
 const plan=buildCouncilExternalIntent({role:'Generator',shared,
  capability:'mahoraga.task.prepare',
  target:{repository:'michaeljwilliams0123/mahoraga',sourceSha:peer,
   taskType:'repo.inspect',allowedPaths:['src/task-relay-contract.mjs']},
  attempt:1,maxPaidCents:0});
 assert.equal(plan.mode,'proposal-only');
 assert.equal(plan.target.repository,'michaeljwilliams0123/mahoraga');
 await assert.rejects(runCouncilExternalIntent({plan,actor:await actor('Generator'),
  transport:{submitTask:async()=>({ok:true})}}),/external-live-write-not-authorized/);
});
