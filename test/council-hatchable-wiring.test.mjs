import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNCIL_ROLES,COUNCIL_TABLES,assessCouncilWiring} from
 '../cloud/hatchable/lib/council-wiring.js';
import {readFileSync} from 'node:fs';
test('C04 Hatchable V8 readiness exposes all missing live Council prerequisites',()=>{
 const r=assessCouncilWiring({tables:[
  'brain_tasks','brain_events','brain_runtime_control','brain_signed_inbox',
  'capability_attempts','mahoraga_actions'
 ]});
 assert.equal(r.canonicalStateOwner,'Hatchable/PostgreSQL');
 assert.equal(r.roleCount,7);
 assert.equal(r.githubRoleInstallationsObserved,0);
 assert.ok(r.missingTables.includes('brain_continuum_outbox'));
 assert.ok(r.missingTables.includes('brain_council_cases'));
 assert.equal(r.readyForProduction,false);
 assert.equal(r.paidExternalSpendCeilingUSD,0);
 assert.equal(r.releaseApproved,false);
 assert.equal(COUNCIL_TABLES.length,10);
});
test('C04 Hatchable readiness never converts seven installations into release approval',()=>{
 const installs=COUNCIL_ROLES.map((role,i)=>({
  role,source:'github-installations-api',appId:i+1,installationId:i+100,
  repositoryUltronVerified:true,repositoryMahoragaVerified:true
 }));
 const r=assessCouncilWiring({tables:COUNCIL_TABLES,installationObservations:installs});
 assert.equal(r.githubRoleInstallationsObserved,7);
 assert.equal(r.missingTables.length,0);
 assert.equal(r.readyForProduction,false);
 assert.equal(r.releaseApproved,false);
 assert.ok(r.missingProduction.includes('independent-executor-unverified'));
 assert.throws(()=>assessCouncilWiring({tables:COUNCIL_TABLES,
  installationObservations:[installs[0],installs[0]]}),/duplicate-role/);
});
test('C04 Hatchable API is admin-only GET, read-only SQL and V8-native imports',()=>{
 const path=new URL('../cloud/hatchable/api/brain/council-readiness.js',import.meta.url);
 const code=readFileSync(path,'utf8');
 assert.match(code,/access\s*=\s*'admin'/);
 assert.match(code,/methods\s*=\s*\['GET'\]/);
 assert.match(code,/information_schema\.tables/);
 assert.match(code,/table_schema\s*=\s*current_schema\(\)/);
 assert.doesNotMatch(code,/table_schema='public'/);
 assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
 assert.doesNotMatch(code,/from\s*['"]node:/);
 const lib=readFileSync(new URL('../cloud/hatchable/lib/council-wiring.js',import.meta.url),'utf8');
 assert.doesNotMatch(lib,/from\s*['"]node:/);
});

test('C04 cloud brain distinguishes deployed capability registry from source-only Council intents',()=>{
 const deployed=[
  {id:'repo.inspect',effect:'read'},{id:'repo.prs',effect:'read'},
  {id:'repo.ci',effect:'read'},{id:'site.render',effect:'read'},
  {id:'council.review',effect:'advisory'}
 ];
 const r=assessCouncilWiring({tables:COUNCIL_TABLES,runtimeCapabilities:deployed});
 assert.equal(r.capabilities.length,8);
 for(const x of deployed){
  const rec=r.capabilities.find(c=>c.id===x.id);
  assert.equal(rec.status,'runtime-registered');
  assert.equal(rec.effect,x.effect);
  assert.equal(rec.liveAcceptanceVerified,false);
 }
 for(const id of ['web.open','mahoraga.repo.inspect','mahoraga.task.prepare']){
  const rec=r.capabilities.find(c=>c.id===id);
  assert.equal(rec.status,'source-candidate-not-deployed');
  assert.equal(rec.liveAcceptanceVerified,false);
 }
 assert.equal(r.readyForProduction,false);
 assert.equal(r.provenance.runtimeEvidence,'hatchable-deployed-brain-core-capabilities');
 assert.equal(r.provenance.candidateEvidence,'git-pr-208-unmerged');
 assert.throws(()=>assessCouncilWiring({tables:COUNCIL_TABLES,
  runtimeCapabilities:[{id:'web.open',effect:'write'}]}),/observation-invalid/);
 assert.throws(()=>assessCouncilWiring({tables:COUNCIL_TABLES,
  runtimeCapabilities:[deployed[0],deployed[0]]}),/observation-invalid/);
});
test('C04 cloud readiness imports the current deployed Brain capability inventory',()=>{
 const src=readFileSync(new URL('../cloud/hatchable/api/brain/council-readiness.js',import.meta.url),'utf8');
 assert.match(src,/CAPABILITIES/);
 assert.match(src,/runtimeCapabilities\s*:\s*CAPABILITIES/);
});
