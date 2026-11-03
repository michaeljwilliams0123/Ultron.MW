import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerAutonomyProfile,assessOwnerAutonomyRequest,
  OWNER_AUTONOMY_OPERATIONS} from '../src/owner-autonomy-profiles.mjs';
import {autonomyLimits} from '../src/owner-autonomy.mjs';

const NOW='2026-11-02T22:00:00.000Z';
const OPTIONS={
  preset:'build',owner:'michaeljwilliams0123',
  objectiveId:'continuum-c18-objective-01',revision:1,
  expiresAt:'2026-11-03T22:00:00.000Z',
};
const profile=(patch={})=>createOwnerAutonomyProfile({...OPTIONS,...patch});
const assess=(p,op,patch={})=>assessOwnerAutonomyRequest({
  profile:p,operation:op,objectiveId:OPTIONS.objectiveId,
  now:NOW,controls:{paused:false,revoked:false},
  estimatedPaidCents:0,...patch,
});

test('owner customization supports three progressive modes with explicit authority requirements',()=>{
  const observe=profile({preset:'observe'});
  const build=profile();
  const release=profile({preset:'release'});
  assert.equal(assess(observe,'research.public').disposition,'routine-preflight-eligible');
  assert.equal(assess(observe,'branch.update').disposition,'held');
  assert.equal(assess(build,'branch.update').disposition,'routine-preflight-eligible');
  assert.equal(assess(build,'pr.squash.merge').disposition,'held');
  const merge=assess(release,'pr.squash.merge');
  assert.equal(merge.disposition,'routine-preflight-eligible');
  assert.ok(!merge.requiredRuntimeChecks.includes('independent-review'));
  assert.ok(merge.requiredRuntimeChecks.includes('exact-head-ci'));
  assert.ok(merge.requiredRuntimeChecks.includes('github-merge-eligibility'));
  assert.ok(merge.requiredRuntimeChecks.includes('authenticated-owner-grant'));
  assert.equal(merge.executionAuthorized,false);
  assert.equal(merge.productionAccepted,false);
});

test('profiles provide customizable operation families without weakening hard floors',()=>{
  const p=profile({
    preset:'observe',allowedOperations:['research.public','branch.create','capability.sandbox.propose'],
    limits:{maxFiles:14,maxFileBytes:20000,maxTotalBytes:80000,
      maxConcurrent:3,maxSteps:18},
  });
  assert.equal(assess(p,'branch.create').disposition,'routine-preflight-eligible');
  assert.equal(assess(p,'capability.sandbox.propose').disposition,'routine-preflight-eligible');
  assert.equal(assess(p,'pr.squash.merge').disposition,'held');
  assert.equal(p.limits.maxFiles,14);
  assert.equal(p.limits.maxConcurrent,3);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.allowedOperations));
  assert.ok(Object.isFrozen(p.limits));
  assert.match(p.digest,/^[a-f0-9]{64}$/);
  assert.equal(p.digest,profile({
    preset:'observe',allowedOperations:['capability.sandbox.propose','branch.create','research.public'],
    limits:{maxFiles:14,maxFileBytes:20000,maxTotalBytes:80000,
      maxConcurrent:3,maxSteps:18},
  }).digest);
});

test('unknown, privileged, paid, secret, destructive and self-approval scopes cannot be made routine',()=>{
  for(const operation of [
    'admin.modify','credential.create','credential.rotate',
    'billing.spend','external.irreversible','pr.self.approve',
    'protected.main.force-push','permissions.widen','some-new-operation'
  ]){
    assert.throws(()=>profile({allowedOperations:['research.public',operation]}),
      /Invalid autonomy/);
    const status=assess(profile({preset:'release'}),operation);
    assert.notEqual(status.disposition,'routine-preflight-eligible');
    assert.equal(status.executionAuthorized,false);
  }
  assert.equal(OWNER_AUTONOMY_OPERATIONS.includes('pr.self.approve'),false);
});

test('owner veto/stop, expiry, drift, wrong owner, and positive spend fail closed',()=>{
  const p=profile();
  const cases=[
    {controls:{paused:true,revoked:false}},
    {controls:{paused:false,revoked:true}},
    {controls:null},
    {objectiveId:'foreign-objective'},
    {now:'2026-11-04T00:00:00.000Z'},
    {estimatedPaidCents:1},
    {estimatedPaidCents:-1},
    {estimatedPaidCents:'0'},
  ];
  for(const patch of cases){
    const r=assess(p,'branch.create',patch);
    assert.equal(r.disposition,'held',JSON.stringify(patch));
    assert.equal(r.executionAuthorized,false);
  }
  assert.throws(()=>profile({owner:'attacker'}),/Invalid autonomy/);
  assert.throws(()=>profile({expiresAt:'2026-02-30T00:00:00.000Z'}),/Invalid autonomy/);
  assert.throws(()=>profile({revision:-1}),/Invalid autonomy/);
});

test('per-operation runtime admission and rate/fencing still mandatory despite high autonomy',()=>{
  const p=profile({preset:'release'});
  const basic=assess(p,'branch.update');
  assert.ok(basic.requiredRuntimeChecks.includes('capability-binding-readback'));
  assert.ok(basic.requiredRuntimeChecks.includes('durable-stop-and-fence'));
  assert.ok(basic.requiredRuntimeChecks.includes('idempotency-and-postcondition'));
  assert.equal(basic.executionAuthorized,false);
  const deploy=assess(p,'deploy.reversible');
  assert.ok(deploy.requiredRuntimeChecks.includes('verified-rollback'));
  assert.ok(!deploy.requiredRuntimeChecks.includes('independent-review'));
  assert.equal(deploy.executionAuthorized,false);
});

test('custom quotas must stay within cost-free bounded resource ceilings',()=>{
  for(const limits of [
    {maxFiles:65},{maxFiles:0},{maxConcurrent:16},{maxSteps:1001},
    {maxFileBytes:2000000},{maxTotalBytes:10000000},
    {maxFiles:2.5},{maxConcurrent:'4'}, {otherLimit:1}
  ])assert.throws(()=>profile({limits}),/Invalid autonomy/);
  assert.throws(()=>profile({paidSpendCeilingCents:2}),/Invalid autonomy/);
  assert.throws(()=>profile({allowedOperations:['research.public','research.public']}),/Invalid autonomy/);
});

test('existing owner autonomy can use bounded configurable build limits, without mutating baseline',()=>{
  const p=profile({limits:{maxFiles:20,maxFileBytes:28000,
    maxTotalBytes:150000,maxConcurrent:3,maxSteps:32}});
  assert.equal(autonomyLimits({}).maxFiles,4);
  assert.equal(autonomyLimits({OWNER_MODE:'1'}).maxFiles,12);
  const a=autonomyLimits({OWNER_MODE:'1'},p);
  assert.equal(a.mode,'owner-autonomy');
  assert.equal(a.maxFiles,20);
  assert.equal(a.maxFileBytes,28000);
  assert.equal(a.maxTotalBytes,150000);
  assert.equal(a.maxConcurrent,3);
  assert.equal(a.profileDigest,p.digest);
  assert.equal(autonomyLimits({},p).maxFiles,4,
    'an unauthenticated source profile is not an owner-mode activation');
});

test('malicious getters are not executed to enlarge a profile',()=>{
  let calls=0;
  const options={...OPTIONS};
  Object.defineProperty(options,'allowedOperations',{enumerable:true,
    get(){calls++;return ['admin.modify']}});
  assert.throws(()=>createOwnerAutonomyProfile(options),/Invalid autonomy/);
  assert.equal(calls,0);
});
