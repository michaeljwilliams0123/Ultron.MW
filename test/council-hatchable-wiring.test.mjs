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
 assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
 assert.doesNotMatch(code,/from\s*['"]node:/);
 const lib=readFileSync(new URL('../cloud/hatchable/lib/council-wiring.js',import.meta.url),'utf8');
 assert.doesNotMatch(lib,/from\s*['"]node:/);
});
