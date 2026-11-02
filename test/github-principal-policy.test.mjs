import test from 'node:test';
import assert from 'node:assert/strict';
import {
 assertOperationAuthorization,assertUnifiedGitHubIdentity,
 evaluateProtectedHead,operationProfile,requiredTokenPermissions,
 ULTRON_GITHUB_PRINCIPAL,ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
} from '../src/github-principal-policy.mjs';

const NOW='2026-10-31T20:00:00Z';
const SHA='a'.repeat(40);
const identity=(operation,patch={})=>({
 source:'github-installation-token-readback',verified:true,
 principal:ULTRON_GITHUB_PRINCIPAL,repository:ULTRON_REPOSITORY,
 repositoryId:ULTRON_REPOSITORY_ID,installationId:9123,
 actorRef:'github-app:ultron-operator',operation,
 expiresAt:'2026-10-31T20:30:00Z',permissions:requiredTokenPermissions(operation),
 ...patch,
});
const authorization=(operation,source,patch={})=>({
 source,verified:true,actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
 operation,planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',
 installationId:9123,grantId:'grant:unified-001',expiresAt:'2026-10-31T20:05:00Z',
 ...patch,
});

test('one installation identity is down-scoped to one exact operation profile',()=>{
 for(const operation of ['repair.branch.update','repair.pr.create',
  'actions.verify.dispatch','repository.settings.update']){
  const result=assertUnifiedGitHubIdentity(identity(operation),{operation,now:NOW});
  assert.equal(result.principal,ULTRON_GITHUB_PRINCIPAL);
  assert.equal(result.operation,operation);
  assert.equal(Object.isFrozen(requiredTokenPermissions(operation)),true);
 }
 assert.deepEqual(requiredTokenPermissions('repair.branch.update'),
  {metadata:'read',contents:'write'});
 assert.deepEqual(requiredTokenPermissions('repository.settings.update'),
  {metadata:'read',administration:'write'});
});

test('identity readback rejects broad, mismatched, stale and offset-less tokens',()=>{
 for(const patch of [
  {principal:'admin-app'},
  {operation:'actions.cancel'},
  {permissions:{metadata:'read',contents:'write',administration:'write'}},
  {expiresAt:'2026-10-31T20:30:00'},
  {expiresAt:'2026-10-31T21:00:01Z'},
  {repository:'other/repo'},
 ]) assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('repair.branch.update',patch),
  {operation:'repair.branch.update',now:NOW}),/identity|profile/i);
});

test('routine operations accept only standing grants and high-impact operations require step-up',()=>{
 const routine='actions.rerun_failed',stepUp='repository.settings.update';
 assert.equal(operationProfile(routine).authorization,'standing');
 assert.equal(operationProfile(stepUp).authorization,'step-up');
 const common={planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',
  installationId:9123,now:NOW};
 assert.equal(assertOperationAuthorization(authorization(routine,
  'independent-standing-grant'),{operation:routine,...common}).authorization,'standing');
 assert.equal(assertOperationAuthorization(authorization(stepUp,
  'independent-owner-authorization'),{operation:stepUp,...common}).authorization,'step-up');
 assert.throws(()=>assertOperationAuthorization(authorization(stepUp,
  'independent-standing-grant'),{operation:stepUp,...common}),/authorization/i);
 assert.throws(()=>assertOperationAuthorization(authorization(routine,
  'independent-owner-authorization'),{operation:routine,...common}),/authorization/i);
});

test('protected-head evidence is exact-sha, fresh, check-complete and independently reviewed',()=>{
 const evidence={source:'github-protected-head-readback',verified:true,
  headSha:SHA,observedAt:'2026-10-31T19:59:00Z',checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA},
  ],review:{state:'approved',headSha:SHA,independent:true,actorRef:'github:user:reviewer'}};
 const ready=evaluateProtectedHead(evidence,{headSha:SHA,
  principalActorRef:'github-app:ultron-operator',now:NOW});
 assert.deepEqual(ready,{ready:true,executable:false,headSha:SHA,
  reason:'exact-head-checks-and-independent-review'});
 for(const patch of [
  {headSha:'c'.repeat(40)},
  {observedAt:'2026-10-31T19:50:00Z'},
  {checks:evidence.checks.slice(0,1)},
  {review:{...evidence.review,actorRef:'github-app:ultron-operator'}},
  {review:{...evidence.review,independent:false}},
 ]) assert.equal(evaluateProtectedHead({...evidence,...patch},{headSha:SHA,
  principalActorRef:'github-app:ultron-operator',now:NOW}).ready,false);
 assert.equal(evaluateProtectedHead(evidence,{headSha:SHA,
  principalActorRef:'',now:NOW}).ready,false);
});


test('policy rejects inherited operation names before deriving authority',()=>{
 for(const operation of ['constructor','toString','__proto__']){
  assert.throws(()=>operationProfile(operation),/not admitted/i);
  assert.throws(()=>requiredTokenPermissions(operation),/not admitted/i);
 }
});

test('protected-head rejects conflicting status entries at same exact head',()=>{
 const evidence={source:'github-protected-head-readback',verified:true,
  headSha:SHA,observedAt:'2026-10-31T19:59:00Z',checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA},
   {name:'test',status:'completed',conclusion:'failure',headSha:SHA},
  ],review:{state:'approved',headSha:SHA,independent:true,actorRef:'github:user:reviewer'}};
 assert.equal(evaluateProtectedHead(evidence,{headSha:SHA,
  principalActorRef:'github-app:ultron-operator',now:NOW}).ready,false);
});


test('RED: impossible calendar timestamps cannot authorize GitHub principal or protected head',async()=>{
 const {parseInstant}=await import('../src/github-principal-policy.mjs');
 const invalid='2026-02-30T20:00:00Z';
 const realNow='2026-03-02T20:00:00Z'; // Date.parse normalizes Feb 30 to Mar 2
 assert.ok(Number.isNaN(parseInstant(invalid)),'nonexistent February date must not parse');
 assert.throws(()=>assertUnifiedGitHubIdentity(
   identity('repair.branch.update',{expiresAt:'2026-02-30T20:30:00Z'}),
   {operation:'repair.branch.update',now:realNow}
 ),/identity|profile/i);
 const op='actions.rerun_failed';
 assert.throws(()=>assertOperationAuthorization(
   authorization(op,'independent-standing-grant',
     {expiresAt:'2026-02-30T20:05:00Z'}),
   {operation:op,planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',
    installationId:9123,now:realNow}
 ),/authorization/i);
 const protectedEvidence={
   source:'github-protected-head-readback',verified:true,
   headSha:SHA,observedAt:'2026-02-30T19:59:00Z',
   checks:[
     {name:'test',status:'completed',conclusion:'success',headSha:SHA},
     {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA}
   ],
   review:{state:'approved',headSha:SHA,independent:true,
     actorRef:'github:user:independent-reviewer'}
 };
 assert.equal(evaluateProtectedHead(protectedEvidence,{
   headSha:SHA,principalActorRef:'github-app:ultron-operator',now:realNow
 }).ready,false);
});


test('RED: impossible RFC3339 clock fields and offsets never authorize principals',async()=>{
 const {parseInstant}=await import('../src/github-principal-policy.mjs');
 const invalid=[
  '2026-11-01T24:00:00Z',
  '2026-11-01T12:00:00+14:30',
  '2026-11-01T12:00:00+23:59',
  '2026-11-01T12:00:00-23:00',
  '2026-11-01T12:00:00+14:01'
 ];
 for(const value of invalid)
  assert.ok(Number.isNaN(parseInstant(value)),
   'malformed or out-of-range global instant must fail closed: '+value);
 assert.ok(Number.isFinite(parseInstant('2026-11-01T12:00:00+14:00')));
 assert.ok(Number.isFinite(parseInstant('2026-11-01T12:00:00-05:00')));
});


test('RED owner authority: authenticated queue approval is sufficient without a second review',()=>{
 const ownerApproval={
  source:'github-owner-queue-attestation',verified:true,
  actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
  issueNumber:209,commentId:6579368546,
  scope:'routine-source-squash',decision:'approved',
  approvedPrNumbers:[212,210,207,208,200,199,176]
 };
 const evidence={
  source:'github-protected-head-readback',verified:true,headSha:SHA,
  observedAt:'2026-10-31T19:59:00Z',
  checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA}
  ],
  ownerApproval,
  githubRules:{source:'github-enforced-merge-readback',verified:true,eligible:true},
  dependenciesSatisfied:true,materialSecurityFindingsClear:true
 };
 const opts={headSha:SHA,prNumber:212,principalActorRef:'github-app:ultron-operator',now:NOW};
 const authorized=evaluateProtectedHead(evidence,opts);
 assert.equal(authorized.ready,true,'no additional reviewer needed for owner-approved routine PR');
 assert.equal(authorized.reason,'exact-head-checks-and-owner-authorization');
 const bad=[
  {...evidence,ownerApproval:undefined,
    review:{state:'approved',headSha:SHA,independent:true,actorRef:'github:user:someone'}},
  {...evidence,ownerApproval:{...ownerApproval,actor:'other-owner'}},
  {...evidence,ownerApproval:{...ownerApproval,verified:false}},
  {...evidence,ownerApproval:{...ownerApproval,approvedPrNumbers:[210]}},
  {...evidence,githubRules:{...evidence.githubRules,eligible:false}},
  {...evidence,materialSecurityFindingsClear:false},
  {...evidence,dependenciesSatisfied:false},
  {...evidence,observedAt:'2026-10-31T19:48:00Z'},
 ];
 for(const attempt of bad)assert.equal(evaluateProtectedHead(attempt,opts).ready,false);
 const securityHold=evaluateProtectedHead(evidence,{...opts,prNumber:200});
 assert.equal(securityHold.ready,false,'Reef #201 must keep independent security clearance');
 const parked=evaluateProtectedHead({...evidence,ownerApproval:{
   ...ownerApproval,approvedPrNumbers:[198,212]
 }},{...opts,prNumber:198});
 assert.equal(parked.ready,false,'parked Admin App cannot skip architecture reconciliation');
});
