import test from 'node:test';
import assert from 'node:assert/strict';
import {providerManifestReadiness} from '../cloud/hatchable/lib/provider-manifest-readiness.js';

test('all eight manifests fail closed without authenticated observations',()=>{
 const result=providerManifestReadiness();
 assert.equal(result.manifests.length,8);
 assert.equal(new Set(result.manifests.map(m=>m.id)).size,8);
 for(const m of result.manifests){
  assert.equal(m.state,'blocked');assert.equal(m.ready,false);
  assert.equal(m.executionAuthorized,false);assert.equal(m.paidCeilingCents,0);
 }
});
test('authenticated reads establish connection but cannot establish execution readiness',()=>{
 const result=providerManifestReadiness({githubOauth:{
  state:'identity-and-repository-read-verified',actor:'michaeljwilliams0123ultron',mainSha:'a'.repeat(40),
  secret:'must-not-leak',ready:true},gitlabRead:{state:'authenticated-read',httpStatus:200}});
 assert.equal(result.manifests[0].state,'connected');
 assert.equal(result.manifests[1].state,'connected');
 assert.ok(result.manifests.every(m=>m.ready===false&&m.executionAuthorized===false));
 assert.ok(!JSON.stringify(result).includes('must-not-leak'));
});
test('wrong identity, malformed source and non-200 responses cannot claim connection',()=>{
 for(const githubOauth of [
  {state:'identity-and-repository-read-verified',actor:'other',mainSha:'a'.repeat(40)},
  {state:'identity-and-repository-read-verified',actor:'michaeljwilliams0123ultron',mainSha:'bad'},
  {state:'credentials-present-unverified',actor:'michaeljwilliams0123ultron',mainSha:'a'.repeat(40)},
 ])assert.equal(providerManifestReadiness({githubOauth}).manifests[0].connected,false);
 assert.equal(providerManifestReadiness({gitlabRead:{state:'authenticated-read',httpStatus:403}}).manifests[1].connected,false);
});
