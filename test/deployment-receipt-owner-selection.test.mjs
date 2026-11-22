import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOwnerProfile,DEFAULT_OPERATIONS}
 from '../cloud/hatchable/lib/owner-autonomy-control.js';
import {prepareDeploymentReleaseReceipt}
 from '../cloud/hatchable/lib/deployment-release-receipt.js';

const ownerProfile=(operations)=>({
 owner:'michaeljwilliams0123',preset:'release',version:12,
 stopVersion:7,paused:false,maxPaidCents:0,
 allowedOperations:operations,
 limits:{maxFiles:24,maxFileBytes:36000,maxTotalBytes:192000,
  maxConcurrent:8,maxSteps:48}
});
const receipt={
 key:'deploy-v144-main',target:'hatchable-v144',
 sourceSha:'f'.repeat(40),artifactDigest:'sha256:'+'a'.repeat(64),
 manifestFileCount:269,independentReadback:true
};

test('cloud.deploy is owner-selectable but absent from every preset',()=>{
 for(const preset of Object.values(DEFAULT_OPERATIONS))
  assert.equal(preset.includes('cloud.deploy'),false);
 const chosen=[...DEFAULT_OPERATIONS.release,'cloud.deploy'];
 const profile=normalizeOwnerProfile(ownerProfile(chosen));
 assert.deepEqual(profile.allowedOperations,chosen);
 assert.equal(profile.executionAuthorized,false);
 assert.equal(profile.runtimeEnforced,false);
 assert.equal(profile.maxPaidCents,0);
});

test('unsupported merge alias and duplicate selections still fail closed',()=>{
 for(const ops of [
  [...DEFAULT_OPERATIONS.release,'pr.merge'],
  [...DEFAULT_OPERATIONS.release,'cloud.deploy','cloud.deploy']
 ])assert.throws(()=>normalizeOwnerProfile(ownerProfile(ops)),
  /autonomy-profile-unavailable/);
});

test('deployment receipt is prepared only for an owner-selected operation',async()=>{
 const granted=[...DEFAULT_OPERATIONS.release,'cloud.deploy'];
 const accepted=normalizeOwnerProfile(ownerProfile(granted));
 const db={query:async()=>({rows:[{
  owner:accepted.owner,preset:accepted.preset,
  profile_version:accepted.version,max_paid_cents:accepted.maxPaidCents,
  allowed_operations:accepted.allowedOperations,paused:accepted.paused,
  stop_version:accepted.stopVersion
 }]})};
 const result=await prepareDeploymentReleaseReceipt({db,request:receipt});
 assert.equal(result.ok,true);
 assert.equal(result.status,'prepared');
 assert.equal(result.operation,'cloud.deploy');
 assert.equal(result.grantRequest.operation,'cloud.deploy');
 assert.equal(result.grantRequest.profileVersion,12);
 assert.equal(result.grantRequest.stopVersion,7);
 assert.equal(result.grantRequest.administrativeChange,false);
 assert.equal('envelope' in result,false);

 const denied=await prepareDeploymentReleaseReceipt({
  db:{query:async()=>({rows:[{owner:'michaeljwilliams0123',
   preset:'release',profile_version:12,max_paid_cents:0,
   allowed_operations:[...DEFAULT_OPERATIONS.release],
   paused:false,stop_version:7}]})},
  request:receipt
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,'authority-denied');
});
