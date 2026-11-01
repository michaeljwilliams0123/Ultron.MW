import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
 COUNCIL_APP_ROLES, councilAlias,buildCouncilAppManifest,
 validateInstallationObservation,authenticateCouncilAppActor,decideCouncilAction,
 councilCapacityReport
} from '../src/council-app-identities.mjs';

const repo='michaeljwilliams0123/Ultron.MW';
const base={repository:repo,webhookUrl:'https://ultron-mw-cloud.hatchable.site/api/brain/council-events'};
test('C04: seven distinct GitHub App registrations, never seven fictional GitHub users',()=>{
 assert.equal(COUNCIL_APP_ROLES.length,7);
 assert.equal(new Set(COUNCIL_APP_ROLES).size,7);
 const manifests=COUNCIL_APP_ROLES.map(role=>buildCouncilAppManifest(role,base));
 assert.equal(new Set(manifests.map(m=>m.name)).size,7);
 for(const m of manifests){
   assert.equal(m.public,false);
   assert.equal(m.hook_attributes.active,false);
   assert.deepEqual(m.default_events,[]);
   assert.equal(m.default_permissions.metadata,'read');
   assert.equal(m.default_permissions.administration,undefined);
   assert.equal(m.default_permissions.secrets,undefined);
   assert.equal(m.default_permissions.actions,'read');
   assert.equal(m.default_permissions.pull_requests,'write');
   assert.equal(m.url,'https://github.com/'+repo);
 }
 assert.deepEqual(COUNCIL_APP_ROLES,[
 'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
 ]);
});
test('C04: requested broad permission blueprint is explicit but does not imply installation or authority',()=>{
 const m=buildCouncilAppManifest('Builder',{...base,profile:'owner-requested'});
 assert.equal(m.default_permissions.administration,'write');
 assert.equal(m.default_permissions.actions,'write');
 assert.equal(m.default_permissions.workflows,'write');
 assert.equal(m.default_permissions.contents,'write');
 assert.equal(m.default_permissions.pull_requests,'write');
 assert.equal(m.hook_attributes.active,false);
 assert.equal(m.default_permissions.secrets,undefined);
 assert.throws(()=>buildCouncilAppManifest('Builder',{...base,profile:'superuser'}),/profile-invalid/);
});
test('C04: +Role email routing does not manufacture GitHub accounts or credentials',()=>{
 assert.equal(councilAlias('Michaelj.williams0123@gmail.com','Builder'),
   'Michaelj.williams0123+Builder@gmail.com');
 assert.equal(councilAlias('Michaelj.williams0123+anything@gmail.com','Skeptic'),
   'Michaelj.williams0123+Skeptic@gmail.com');
 assert.throws(()=>councilAlias('not-an-email','Builder'),/mailbox-invalid/);
 assert.throws(()=>councilAlias('a@example.com','Director'),/role-invalid/);
});
test('C04: no installation observation is never an authenticated council contributor',()=>{
 const expected={role:'Builder',repository:repo};
 assert.deepEqual(validateInstallationObservation(expected,null),{
  role:'Builder',state:'unregistered',authenticated:false,canReview:false
 });
 assert.throws(()=>validateInstallationObservation(expected,{
  source:'github-installations-api',app_slug:'ultron-mw-skeptic',
  app_id:4,id:5,repositories:[repo],permissions:{pull_requests:'write'}
 }),/identity-mismatch/);
});
test('C04: live API observation checks distinct app, repository and permissions; never grants reviewer status automatically',()=>{
 const observed={source:'github-installations-api',app_slug:'ultron-mw-builder',
   app_id:88101,id:99201,account:{login:'michaeljwilliams0123'},
   repository_selection:'selected',repositories:[repo],suspended_at:null,
   permissions:{metadata:'read',contents:'read',issues:'write',pull_requests:'write',actions:'read',checks:'read'}};
 const result=validateInstallationObservation({role:'Builder',repository:repo},observed);
 assert.equal(result.state,'installed-observed');
 assert.equal(result.authenticated,false);
 assert.equal(result.canReview,false);
 assert.equal(result.appId,88101);
 assert.throws(()=>validateInstallationObservation({role:'Builder',repository:repo},
  {...observed,repositories:['other/repo']}),/repository-not-installed/);
 assert.throws(()=>validateInstallationObservation({role:'Builder',repository:repo},
  {...observed,permissions:{...observed.permissions,pull_requests:'read'}}),/permission-missing/);
});
test('C04: unverified or self-approved owner-like operations are denied regardless of configured App permissions',async()=>{
 const observed={source:'github-installations-api',app_slug:'ultron-mw-builder',
   app_id:88101,id:99201,account:{login:'michaeljwilliams0123'},
   repository_selection:'selected',repositories:[repo],suspended_at:null,
   permissions:{metadata:'read',contents:'read',issues:'write',pull_requests:'write',actions:'read',checks:'read'}};
 const actor=await authenticateCouncilAppActor({
   role:'Builder',installationToken:'ephemeral-test-token',sourceSha:'a'.repeat(40),
   githubProbe:async()=>observed
 });
 assert.deepEqual(decideCouncilAction(actor,{operation:'comment',repository:repo}),{
   allowed:true,scope:repo,role:'Builder',reason:'scoped-operation'
 });
 for(const operation of ['merge','approve-own-pr','grant-admin','change-secrets','deploy','change-branch-protection']){
  assert.deepEqual(decideCouncilAction(actor,{operation,repository:repo}).allowed,false);
 }
 assert.equal(decideCouncilAction({...actor,verifiedBy:'owner-text'},
   {operation:'comment',repository:repo}).allowed,false);
 assert.equal(decideCouncilAction(actor,{operation:'comment',repository:'other/repo'}).allowed,false);
 assert.equal(decideCouncilAction({...actor},{operation:'comment',repository:repo}).allowed,false);
 await assert.rejects(authenticateCouncilAppActor({
  role:'Skeptic',sourceSha:'a'.repeat(40),installationToken:'ephemeral-test-token',
  githubProbe:async()=>observed
 }),/identity-mismatch/);
});
test('C04: no fictional additive AI token pool or GitHub Actions credits',()=>{
 const report=councilCapacityReport({installedAppCount:7,rateLimits:[5000,5000,5000,5000,5000,5000,5000]});
 assert.equal(report.paidInferenceCeilingUSD,0);
 assert.equal(report.additionalAIModelTokens,0);
 assert.equal(report.additionalActionsMinutes,0);
 assert.equal(report.apiBucketsObserved,7);
 assert.equal(report.apiRateBudgetNotTransferable,true);
 assert.equal(report.actionsBilledToRepositoryOwner,true);
});
test('C04: CLI builds auditable manifest blueprints without creating Apps or printing credentials',()=>{
 const p=spawnSync(process.execPath,['scripts/council-app-manifests.mjs','--profile=scoped'],
   {encoding:'utf8',env:{...process.env,COUNCIL_NOTIFICATION_MAILBOX:''}});
 assert.equal(p.status,0,p.stderr);
 const result=JSON.parse(p.stdout);
 assert.equal(result.registrationStatus,'NOT_REGISTERED');
 assert.equal(result.identityCount,7);
 assert.equal(result.requiresOwnerInstallApproval,true);
 assert.equal(result.createsSecrets,false);
 assert.equal(new Set(result.apps.map(m=>m.manifest.name)).size,7);
 assert.ok(!/privateKey|clientSecret|webhookSecret|accessToken|password|-----BEGIN /i.test(p.stdout));
});

test('C04: forged token-origin labels never authenticate a council bot',()=>{
 const forged={role:'Builder',installationId:99201,verifiedBy:'github-installation-token',
   sourceSha:'a'.repeat(40),scope:repo};
 // Metadata supplied by a caller, however convincing, cannot authorize a write.
 assert.equal(decideCouncilAction(forged,{operation:'comment',repository:repo}).allowed,false);
});
