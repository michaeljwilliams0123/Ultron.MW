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
  'owner-standing-authorization'),{operation:routine,...common}).authorization,'standing');
 assert.equal(assertOperationAuthorization(authorization(stepUp,
  'owner-step-up-authorization'),{operation:stepUp,...common}).authorization,'step-up');
 assert.throws(()=>assertOperationAuthorization(authorization(stepUp,
  'owner-standing-authorization'),{operation:stepUp,...common}),/authorization/i);
 assert.throws(()=>assertOperationAuthorization(authorization(routine,
  'owner-step-up-authorization'),{operation:routine,...common}),/authorization/i);
});

test('protected-head requires authenticated owner queue approval and exact-head checks',()=>{
 const ownerApproval={source:'github-owner-queue-attestation',verified:true,
  actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
  issueNumber:209,commentId:6579368546,scope:'routine-source-squash',
  decision:'approved',approvedPrNumbers:[212,210,207,208,200,199,176]};
 const evidence={source:'github-protected-head-readback',verified:true,
  headSha:SHA,observedAt:'2026-10-31T19:59:00Z',checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA},
  ],ownerApproval,
  githubRules:{source:'github-enforced-merge-readback',verified:true,eligible:true},
  dependenciesSatisfied:true,materialSecurityFindingsClear:true};
 const opts={headSha:SHA,prNumber:212,principalActorRef:'github-app:ultron-operator',now:NOW};
 const ready=evaluateProtectedHead(evidence,opts);
 assert.deepEqual(ready,{ready:true,executable:false,headSha:SHA,
  reason:'exact-head-checks-and-owner-authorization'});
 for(const patch of [
  {headSha:'c'.repeat(40)},
  {observedAt:'2026-10-31T19:50:00Z'},
  {checks:evidence.checks.slice(0,1)},
  {ownerApproval:{...ownerApproval,actor:'different-owner'}},
  {ownerApproval:{...ownerApproval,verified:false}},
  {githubRules:{...evidence.githubRules,eligible:false}},
  {materialSecurityFindingsClear:false},
  {dependenciesSatisfied:false},
 ]) assert.equal(evaluateProtectedHead({...evidence,...patch},opts).ready,false);
 assert.equal(evaluateProtectedHead(evidence,{...opts,principalActorRef:''}).ready,false);
 assert.equal(evaluateProtectedHead({...evidence,ownerApproval:undefined,
  review:{state:'approved',independent:true,headSha:SHA,
   actorRef:'github:user:independent-reviewer'}},opts).ready,false,
  'a reviewer cannot replace the authenticated owner authorization');
});

test('policy rejects inherited operation names before deriving authority',()=>{
 for(const operation of ['constructor','toString','__proto__']){
  assert.throws(()=>operationProfile(operation),/not admitted/i);
  assert.throws(()=>requiredTokenPermissions(operation),/not admitted/i);
 }
});

test('protected-head rejects conflicting checks even with valid owner approval',()=>{
 const evidence={source:'github-protected-head-readback',verified:true,
  headSha:SHA,observedAt:'2026-10-31T19:59:00Z',checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA},
   {name:'test',status:'completed',conclusion:'failure',headSha:SHA},
  ],ownerApproval:{source:'github-owner-queue-attestation',verified:true,
   actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
   issueNumber:209,commentId:6579368546,scope:'routine-source-squash',
   decision:'approved',approvedPrNumbers:[212]},
  githubRules:{source:'github-enforced-merge-readback',verified:true,eligible:true},
  dependenciesSatisfied:true,materialSecurityFindingsClear:true};
 assert.equal(evaluateProtectedHead(evidence,{headSha:SHA,prNumber:212,
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
   authorization(op,'owner-standing-authorization',
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

test('follow-on PRs require head-bound external-independent evaluation separate from operation grants',()=>{
 const ownerApproval={
  source:'github-owner-queue-attestation',verified:true,
  actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
  issueNumber:209,commentId:6579368546,scope:'routine-source-squash',
  decision:'approved',approvedPrNumbers:[212]
 };
 const independentEvaluation={
  disposition:'Accepted',
  evaluationHeadSha:SHA,
  evaluatedAt:'2026-10-31T19:58:00Z',
  evaluator:{id:'reef-external-evaluator',origin:'external-independent'}
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
  dependenciesSatisfied:true,materialSecurityFindingsClear:true,
  independentEvaluation
 };
 const opts={headSha:SHA,prNumber:212,principalActorRef:'github-app:ultron-operator',now:NOW,affectedFollowOn:true};
 const passed=evaluateProtectedHead(evidence,opts);
 assert.deepEqual(passed,{ready:true,executable:false,headSha:SHA,
  reason:'exact-head-checks-and-owner-authorization'});

 for(const badEval of [
  undefined,
  {...independentEvaluation,disposition:'Rejected'},
  {...independentEvaluation,evaluationHeadSha:'d'.repeat(40)},
  {...independentEvaluation,evaluator:{id:'reef-external-evaluator',origin:'candidate'}},
  {...independentEvaluation,evaluator:{id:'github-app:ultron-operator',origin:'external-independent'}},
  {...independentEvaluation,evaluatedAt:'2026-10-31T19:50:00Z'},
 ]){
  const blocked=evaluateProtectedHead({...evidence,independentEvaluation:badEval},opts);
  assert.equal(blocked.ready,false);
  assert.equal(blocked.executable,false);
  assert.equal(blocked.reason,'independent-head-evaluation-required');
 }

 // Operation authorization remains isolated from Reef evaluation evidence
 const op='actions.rerun_failed';
 const auth=assertOperationAuthorization(
  authorization(op,'owner-standing-authorization'),
  {operation:op,planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW}
 );
 assert.equal(auth.authorization,'standing');
});

// 33 advanced, unique, and purposely confusing edge-case tests (#173 Phase 3)
const followOnBase=()=>{
 const ownerApproval={
  source:'github-owner-queue-attestation',verified:true,
  actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
  issueNumber:209,commentId:6579368546,scope:'routine-source-squash',
  decision:'approved',approvedPrNumbers:[212]
 };
 return {
  source:'github-protected-head-readback',verified:true,headSha:SHA,
  observedAt:'2026-10-31T19:59:00Z',
  checks:[
   {name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA}
  ],
  ownerApproval,
  githubRules:{source:'github-enforced-merge-readback',verified:true,eligible:true},
  dependenciesSatisfied:true,materialSecurityFindingsClear:true,
  independentEvaluation:{
   disposition:'Accepted',
   evaluationHeadSha:SHA,
   evaluatedAt:'2026-10-31T19:58:00Z',
   evaluator:{id:'reef-external-evaluator',origin:'external-independent'}
  }
 };
};
const followOnOpts=(overrides={})=>({
 headSha:SHA,prNumber:212,principalActorRef:'github-app:ultron-operator',
 now:NOW,affectedFollowOn:true,...overrides
});

test('edge 01: whitespace-padded evaluator id matching principalActorRef is blocked',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluator.id='  github-app:ultron-operator  ';
 const r=evaluateProtectedHead(ev,followOnOpts());
 assert.equal(r.ready,false);
 assert.equal(r.reason,'independent-head-evaluation-required');
});

test('edge 02: whitespace-only evaluator id is blocked',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluator.id=' \t ';
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 03: non-string evaluator id (number/object) is blocked',()=>{
 for(const id of [123,{name:'reef'}]){
  const ev=followOnBase();
  ev.independentEvaluation.evaluator.id=id;
  assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 }
});

test('edge 04: future evaluatedAt (1ms ahead of now) is blocked',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluatedAt='2026-10-31T20:00:00.001Z';
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 05: evaluatedAt exactly at 5m00s boundary passes; 5m00.001s fails',()=>{
 const evOk=followOnBase();
 evOk.independentEvaluation.evaluatedAt='2026-10-31T19:55:00.000Z';
 assert.equal(evaluateProtectedHead(evOk,followOnOpts()).ready,true);
 const evStale=followOnBase();
 evStale.independentEvaluation.evaluatedAt='2026-10-31T19:54:59.999Z';
 assert.equal(evaluateProtectedHead(evStale,followOnOpts()).ready,false);
});

test('edge 06: evaluatedAt with invalid calendar date (Feb 30) is blocked',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluatedAt='2026-02-30T19:58:00Z';
 assert.equal(evaluateProtectedHead(ev,followOnOpts({now:'2026-03-02T20:00:00Z'})).ready,false);
});

test('edge 07: uppercase evaluationHeadSha does not match lowercase headSha',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluationHeadSha='A'.repeat(40);
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 08: protected-base origin is insufficient for affectedFollowOn (requires external-independent)',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.evaluator.origin='protected-base';
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 09: Inconclusive and Blocked dispositions block affectedFollowOn',()=>{
 for(const disposition of ['Inconclusive','Blocked','accepted']){
  const ev=followOnBase();
  ev.independentEvaluation.disposition=disposition;
  assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 }
});

test('edge 10: affectedFollowOn=false ignores Rejected independentEvaluation for routine PRs',()=>{
 const ev=followOnBase();
 ev.independentEvaluation.disposition='Rejected';
 assert.equal(evaluateProtectedHead(ev,followOnOpts({affectedFollowOn:false})).ready,true);
});

test('edge 11: leap-year 2024-02-29 and century-400 2000-02-29 parse; 2026-02-29 and 2100-02-29 fail',async()=>{
 const {parseInstant}=await import('../src/github-principal-policy.mjs');
 assert.ok(Number.isFinite(parseInstant('2024-02-29T12:00:00Z')));
 assert.ok(Number.isFinite(parseInstant('2000-02-29T12:00:00Z')));
 assert.ok(Number.isNaN(parseInstant('2026-02-29T12:00:00Z')));
 assert.ok(Number.isNaN(parseInstant('2100-02-29T12:00:00Z')));
});

test('edge 12: negative timezone offset -14:00 parses while -14:01 and lowercase t/z fail',async()=>{
 const {parseInstant}=await import('../src/github-principal-policy.mjs');
 assert.ok(Number.isFinite(parseInstant('2026-11-01T12:00:00-14:00')));
 assert.ok(Number.isNaN(parseInstant('2026-11-01T12:00:00-14:01')));
 assert.ok(Number.isNaN(parseInstant('2026-11-01t12:00:00z')));
});

test('edge 13: check passing on different headSha never satisfies required check on target headSha',()=>{
 const ev=followOnBase();
 ev.checks=[
  {name:'test',status:'completed',conclusion:'success',headSha:'b'.repeat(40)},
  {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA},
 ];
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 14: in_progress check with conclusion=success is rejected',()=>{
 const ev=followOnBase();
 ev.checks[0].status='in_progress';
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 15: duplicate required check where second is neutral/cancelled rejects',()=>{
 for(const conclusion of ['neutral','cancelled','skipped','timed_out']){
  const ev=followOnBase();
  ev.checks.push({name:'fixed-comparison',status:'completed',conclusion,headSha:SHA});
  assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 }
});

test('edge 16: observedAt in the future relative to now is rejected',()=>{
 const ev=followOnBase();
 ev.observedAt='2026-10-31T20:00:01Z';
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 17: approvedPrNumbers containing non-integer or non-positive alongside valid prNumber rejects',()=>{
 for(const badList of [[212,0],[212,-1],[212,1.5],[212,'212']]){
  const ev=followOnBase();
  ev.ownerApproval.approvedPrNumbers=badList;
  assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 }
});

test('edge 18: PR #200 with criticalSecurityHold=false still requires trusted-automated-security-evaluation',()=>{
 const ev=followOnBase();
 ev.ownerApproval.approvedPrNumbers=[200];
 assert.equal(evaluateProtectedHead(ev,followOnOpts({prNumber:200})).ready,false);
 ev.securityEvaluation={source:'trusted-automated-security-evaluation',verified:true,status:'cleared'};
 assert.equal(evaluateProtectedHead(ev,followOnOpts({prNumber:200})).ready,true);
});

test('edge 19: criticalSecurityHold=true on non-200 PR blocks without securityEvaluation',()=>{
 const ev=followOnBase();
 ev.criticalSecurityHold=true;
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 ev.securityEvaluation={source:'trusted-automated-security-evaluation',verified:true,status:'cleared'};
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,true);
});

test('edge 20: securityEvaluation with status!==cleared or verified=false remains blocked',()=>{
 const ev=followOnBase();
 ev.criticalSecurityHold=true;
 ev.securityEvaluation={source:'trusted-automated-security-evaluation',verified:false,status:'cleared'};
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
 ev.securityEvaluation={source:'trusted-automated-security-evaluation',verified:true,status:'held'};
 assert.equal(evaluateProtectedHead(ev,followOnOpts()).ready,false);
});

test('edge 21: identity readback rejects expiresAt equal to now or > 1 hour ahead',()=>{
 assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('repair.branch.update',{expiresAt:NOW}),{operation:'repair.branch.update',now:NOW}
 ),/identity|profile/i);
 assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('repair.branch.update',{expiresAt:'2026-10-31T21:00:00.001Z'}),
  {operation:'repair.branch.update',now:NOW}
 ),/identity|profile/i);
});

test('edge 22: identity readback rejects invalid actorRef format or uppercase',()=>{
 for(const actorRef of ['github-app:ab','github-app:Upper','user:ultron-operator','']){
  assert.throws(()=>assertUnifiedGitHubIdentity(
   identity('identity.read',{actorRef}),{operation:'identity.read',now:NOW}
  ),/identity|profile/i);
 }
});

test('edge 23: identity readback rejects wrong repositoryId or non-integer installationId',()=>{
 assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('identity.read',{repositoryId:999}),{operation:'identity.read',now:NOW}
 ),/identity|profile/i);
 for(const installationId of [0,-5,1.5,'9123']){
  assert.throws(()=>assertUnifiedGitHubIdentity(
   identity('identity.read',{installationId}),{operation:'identity.read',now:NOW}
  ),/identity|profile/i);
 }
});

test('edge 24: identity readback rejects array permissions or missing permission key',()=>{
 assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('repair.branch.update',{permissions:['metadata','contents']}),
  {operation:'repair.branch.update',now:NOW}
 ),/identity|profile/i);
 assert.throws(()=>assertUnifiedGitHubIdentity(
  identity('repair.branch.update',{permissions:{metadata:'read'}}),
  {operation:'repair.branch.update',now:NOW}
 ),/identity|profile/i);
});

test('edge 25: operation authorization rejects expiresAt equal to now or > 10 minutes ahead',()=>{
 const common={planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW};
 assert.throws(()=>assertOperationAuthorization(
  authorization('actions.rerun_failed','owner-standing-authorization',{expiresAt:NOW}),
  {operation:'actions.rerun_failed',...common}
 ),/authorization/i);
 assert.throws(()=>assertOperationAuthorization(
  authorization('actions.rerun_failed','owner-standing-authorization',{expiresAt:'2026-10-31T20:10:00.001Z'}),
  {operation:'actions.rerun_failed',...common}
 ),/authorization/i);
 assert.equal(assertOperationAuthorization(
  authorization('actions.rerun_failed','owner-standing-authorization',{expiresAt:'2026-10-31T20:10:00Z'}),
  {operation:'actions.rerun_failed',...common}
 ).authorization,'standing');
});

test('edge 26: operation authorization rejects mismatched planDigest, idempotencyKey, or installationId',()=>{
 const common={operation:'actions.rerun_failed',planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW};
 for(const patch of [{planDigest:'c'.repeat(64)},{idempotencyKey:'other'},{installationId:9124}]){
  assert.throws(()=>assertOperationAuthorization(
   authorization('actions.rerun_failed','owner-standing-authorization',patch),common
  ),/authorization/i);
 }
});

test('edge 27: operation authorization rejects short or invalid grantId',()=>{
 const common={operation:'actions.rerun_failed',planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW};
 for(const grantId of ['short','grant with space','-leading-dash','']){
  assert.throws(()=>assertOperationAuthorization(
   authorization('actions.rerun_failed','owner-standing-authorization',{grantId}),common
  ),/authorization/i);
 }
});

test('edge 28: operation authorization rejects non-canonical actor',()=>{
 const common={operation:'actions.rerun_failed',planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW};
 assert.throws(()=>assertOperationAuthorization(
  authorization('actions.rerun_failed','owner-standing-authorization',{actor:'github-actions[bot]'}),common
 ),/authorization/i);
});

test('edge 29: returned objects from assertUnifiedGitHubIdentity, assertOperationAuthorization, and evaluateProtectedHead are frozen',()=>{
 const id=assertUnifiedGitHubIdentity(identity('identity.read'),{operation:'identity.read',now:NOW});
 const auth=assertOperationAuthorization(
  authorization('actions.rerun_failed','owner-standing-authorization'),
  {operation:'actions.rerun_failed',planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW}
 );
 const head=evaluateProtectedHead(followOnBase(),followOnOpts());
 assert.equal(Object.isFrozen(id),true);
 assert.equal(Object.isFrozen(auth),true);
 assert.equal(Object.isFrozen(head),true);
});

test('edge 30: mutating returned requiredTokenPermissions does not mutate internal PROFILES',()=>{
 const perms=requiredTokenPermissions('repair.branch.update');
 assert.throws(()=>{perms.administration='write';});
 assert.deepEqual(requiredTokenPermissions('repair.branch.update'),{metadata:'read',contents:'write'});
});

test('edge 31: evaluateProtectedHead handles null/undefined evidence without throwing',()=>{
 for(const ev of [null,undefined,{}]){
  const r=evaluateProtectedHead(ev,followOnOpts());
  assert.equal(r.ready,false);
  assert.equal(r.executable,false);
 }
});

test('edge 32: all step-up profiles reject standing authorization',()=>{
 for(const op of ['actions.enable','actions.disable','repository.settings.update','webhooks.ping']){
  assert.throws(()=>assertOperationAuthorization(
   authorization(op,'owner-standing-authorization'),
   {operation:op,planDigest:'b'.repeat(64),idempotencyKey:'admin:unified-001',installationId:9123,now:NOW}
  ),/authorization/i);
 }
});

test('edge 33: ownerApproval wrong issueNumber or wrong scope is rejected',()=>{
 const ev1=followOnBase();
 ev1.ownerApproval.issueNumber=210;
 assert.equal(evaluateProtectedHead(ev1,followOnOpts()).ready,false);
 const ev2=followOnBase();
 ev2.ownerApproval.scope='emergency-bypass';
 assert.equal(evaluateProtectedHead(ev2,followOnOpts()).ready,false);
});
