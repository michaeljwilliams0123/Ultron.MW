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
