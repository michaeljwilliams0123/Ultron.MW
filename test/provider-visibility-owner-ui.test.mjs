import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerManifestReadiness} from '../cloud/hatchable/lib/provider-manifest-readiness.js';
import {providerVisibilityModel} from '../cloud/hatchable/public/provider-manifest-view.js';

const observations={
 githubOauth:{state:'identity-and-repository-read-verified',
  actor:'michaeljwilliams0123ultron',mainSha:'a'.repeat(40)},
 gitlabRead:{state:'authenticated-read',httpStatus:200},
 gitlabWrite:{state:'read-probe-failed',httpStatus:403},
};

test('C05 evidence descriptors distinguish observed identity from unverified schema, quota, latency and health',()=>{
 const result=providerManifestReadiness(observations);
 assert.equal(result.manifests.length,8);
 const [github,gitlab,...unobserved]=result.manifests;
 assert.equal(github.visibilityEvidence.identity,'michaeljwilliams0123ultron');
 assert.equal(github.visibilityEvidence.identityVerified,true);
 assert.equal(github.visibilityEvidence.operationContract,'declared-not-exercised');
 assert.equal(gitlab.visibilityEvidence.identity,null);
 assert.equal(gitlab.visibilityEvidence.identityVerified,false);
 for(const manifest of result.manifests){
  const evidence=manifest.visibilityEvidence;
  assert.equal(evidence.scopeEnforcement,'unverified');
  assert.equal(evidence.schemaVerified,false);
  assert.equal(evidence.lastProbeAt,null);
  assert.equal(evidence.health,'not-measured');
  assert.equal(evidence.latencyMs,null);
  assert.equal(evidence.quota,'unknown');
  assert.equal(evidence.canary,'not-observed');
  assert.equal(evidence.rollback,'not-observed');
  assert.equal(manifest.executionAuthorized,false);
 }
 assert.ok(unobserved.every(m=>m.visibilityEvidence.identity===null));
});

test('C12 owner UI summarizes eight distinct provider statuses without granting execution',()=>{
 const result=providerVisibilityModel(providerManifestReadiness(observations));
 assert.equal(result.ok,true);
 assert.equal(result.total,8);
 assert.equal(result.connected,2);
 assert.equal(result.blocked,6);
 assert.equal(result.executionAuthorized,0);
 assert.equal(result.rows.length,8);
 assert.equal(result.rows[0].id,'github');
 assert.equal(result.rows[0].connection,'Connected (read observation)');
 assert.equal(result.rows[0].authority,'Not authorized');
 assert.equal(result.rows[0].identity,'michaeljwilliams0123ultron');
 assert.equal(result.rows[1].identity,'Unverified');
 assert.match(result.rows[0].details,/Health: not-measured/);
 assert.match(result.rows[0].details,/Lifecycle: disable\/revoke\/rollback not observed/);
 assert.match(result.rows[7].details,/Operation: none declared/);
});

test('C12 malformed, duplicated, elevated or paid provider claims fail closed',()=>{
 const valid=providerManifestReadiness(observations);
 const invalid=[
  null,{}, {...valid,readOnly:false},{...valid,paidCeilingCents:1},
  {...valid,manifests:valid.manifests.slice(0,7)},
  {...valid,manifests:[...valid.manifests.slice(0,7),valid.manifests[0]]},
  {...valid,manifests:valid.manifests.map((m,i)=>i?m:{...m,id:'other'})},
  {...valid,manifests:valid.manifests.map((m,i)=>i?m:{...m,executionAuthorized:true})},
  {...valid,manifests:valid.manifests.map((m,i)=>i?m:{...m,ready:true})},
  {...valid,manifests:valid.manifests.map((m,i)=>i?m:{...m,paidCeilingCents:50})},
 ];
 for(const payload of invalid){
  const result=providerVisibilityModel(payload);
  assert.equal(result.ok,false);
  assert.deepEqual(result.rows,[]);
  assert.equal(result.executionAuthorized,0);
 }
});

test('C12 existing owner page embeds the inventory in the current UI and uses text-only DOM rendering',()=>{
 const html=readFileSync(new URL('../cloud/hatchable/public/connectors.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../cloud/hatchable/public/connectors.js',import.meta.url),'utf8');
 assert.match(html,/id="provider-manifests"/);
 assert.match(html,/id="provider-status"/);
 assert.match(html,/<script type="module" src="\/connectors\.js"/);
 assert.match(js,/providerVisibilityModel\(data\.providerManifests\)/);
 assert.match(js,/providerContainer\.replaceChildren\(\)/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
 assert.match(js,/detail\.textContent=description/);
});
