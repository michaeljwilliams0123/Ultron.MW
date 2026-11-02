import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {COUNCIL_APP_ROLES,buildCouncilAppManifest,
 authenticateCouncilAppActor,decideCouncilAction} from '../src/council-app-identities.mjs';
import {createSharedCouncilCase,createSMEAssignment,collectCouncilAssessments,
 SME_DOMAINS,COUNCIL_LIFECYCLE} from '../src/council-shared-collaboration.mjs';

const repo='michaeljwilliams0123/Ultron.MW';
const sha='a'.repeat(40),fingerprint='f'.repeat(64);
const url='https://ultron-mw-cloud.hatchable.site/api/brain/council-events';
const profile='collaborative-sme';
const expected={metadata:'read',contents:'write',issues:'write',
 pull_requests:'write',checks:'read',actions:'write'};

test('RED C04: all seven SME Apps receive the same permissions, without automatic admin/secrets',()=>{
 const manifest=COUNCIL_APP_ROLES.map(role=>buildCouncilAppManifest(role,{
   repository:repo,webhookUrl:url,profile
 }));
 assert.equal(manifest.length,7);
 for(const m of manifest){
  assert.deepEqual(m.default_permissions,expected);
  assert.equal(m.hook_attributes.active,false);
  assert.equal(m.default_permissions.administration,undefined);
  assert.equal(m.default_permissions.workflows,undefined);
  assert.equal(m.default_permissions.secrets,undefined);
 }
});

test('RED C04: all seven authenticated roles have equal bounded operations on their own fenced branch',async()=>{
 for(let i=0;i<COUNCIL_APP_ROLES.length;i++){
  const role=COUNCIL_APP_ROLES[i],slug=role.toLowerCase();
  const actor=await authenticateCouncilAppActor({
   role,sourceSha:sha,installationToken:'synthetic-test-token-'+slug,
   profile,githubProbe:async()=>({
    source:'github-installations-api',app_slug:'ultron-mw-'+slug,
    app_id:100+i,id:900+i,repositories:[repo],suspended_at:null,
    permissions:{...expected}
   })
  });
  const req={repository:repo,baseSha:sha,maxPaidCents:0,attempt:1};
  const ownBranch='ultron/council-'+slug+'-new-regression-tests';
  const foreignBranch='ultron/council-'+COUNCIL_APP_ROLES[(i+1)%7].toLowerCase()+'-new-regression-tests';
  assert.equal(decideCouncilAction(actor,{...req,operation:'branch.update',
    branch:ownBranch,path:'test/council-app-identities.test.mjs'}).allowed,true,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'branch.create',branch:ownBranch}).allowed,true,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'pr.create',branch:ownBranch}).allowed,true,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'actions.dispatch',
    workflow:'verify.yml',ref:'main'}).allowed,true,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'review.request-changes',
    prAuthor:'external-contributor'}).allowed,true,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'branch.update',
    branch:foreignBranch,path:'src/continuum-supervisor.mjs'}).allowed,false,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'branch.update',
    branch:'main',path:'src/continuum-supervisor.mjs'}).allowed,false,role);
  assert.equal(decideCouncilAction(actor,{...req,operation:'review.request-changes',
    prAuthor:'ultron-mw-'+slug+'[bot]'}).allowed,false,role);
  for(const operation of ['review.approve','merge','grant-admin','deploy','change-secrets']){
   assert.equal(decideCouncilAction(actor,{...req,operation}).allowed,false,role+' '+operation);
  }
 }
});

const input=()=>({
 repository:repo,objectiveId:'continuum-c04-shared-process',
 taskFingerprint:fingerprint,sourceSha:sha,
 ownerIntent:'One council with equal capability access and specialized assessment',
 lifecycle:'verify',blockedBy:['#183','#184'],
 evidenceRefs:['https://github.com/michaeljwilliams0123/Ultron.MW/pull/208'],
 constraints:{maxPaidCents:0,independentReviewRequired:true},
});

test('RED C04: every role sees exactly the same immutable process, evidence and source',()=>{
 const shared=createSharedCouncilCase(input());
 assert.equal(shared.schema,'ultron.council.shared-case.v1');
 assert.equal(shared.sourceSha,sha);
 assert.equal(shared.taskFingerprint,fingerprint);
 assert.equal(shared.lifecycle,'verify');
 assert.deepEqual(COUNCIL_LIFECYCLE,[
  'intake','plan','authorize','execute','verify','persist','learn'
 ]);
 assert.ok(Object.isFrozen(shared));
 assert.ok(Object.isFrozen(shared.blockedBy));
 assert.ok(Object.isFrozen(shared.constraints));
 assert.equal(typeof shared.caseSha,'string');
 assert.match(shared.caseSha,/^[a-f0-9]{64}$/);
 const assignments=COUNCIL_APP_ROLES.map(role=>createSMEAssignment(shared,role));
 assert.equal(new Set(assignments.map(a=>a.caseSha)).size,1);
 assert.equal(new Set(assignments.map(a=>a.role)).size,7);
 assert.equal(new Set(assignments.map(a=>a.expertise.domain)).size,7);
 assert.ok(assignments.every(a=>a.shared===shared));
 assert.ok(assignments.every(a=>a.modelBacked===false));
 assert.ok(assignments.every(a=>a.expertise.evidenceQuestions.length>=2));
 assert.throws(()=>{shared.blockedBy.push('#999')},TypeError);
 assert.throws(()=>createSMEAssignment(shared,'Administrator'),/role-invalid/);
 assert.equal(Object.keys(SME_DOMAINS).length,7);
});

test('RED C04: timestamp-only changes do not rewrite shared evidence fingerprint',()=>{
 const a=createSharedCouncilCase({...input(),observedAt:'2026-11-01T18:00:00Z'});
 const b=createSharedCouncilCase({...input(),observedAt:'2026-11-01T18:05:00Z'});
 assert.equal(a.caseSha,b.caseSha);
 assert.notEqual(a.caseSha,createSharedCouncilCase({...input(),sourceSha:'b'.repeat(40)}).caseSha);
 assert.notEqual(a.caseSha,createSharedCouncilCase({...input(),ownerIntent:'Changed owner intent'}).caseSha);
});

test('RED C04: conflicting SME recommendations remain attributable, preserve dissent, never self-approve',()=>{
 const shared=createSharedCouncilCase(input());
 const assessments=COUNCIL_APP_ROLES.map((role,i)=>({
  role,caseSha:shared.caseSha,position:i===1?'hold':'proceed',
  evidenceRefs:[shared.evidenceRefs[0]],
  unknowns:i===1?['independent-review-not-observed']:[],
  rationale:'SME advisory position for '+role,
  modelBacked:false,
  githubPrincipal:null
 }));
 const result=collectCouncilAssessments(shared,assessments);
 assert.equal(result.caseSha,shared.caseSha);
 assert.equal(result.memberCount,7);
 assert.equal(result.releaseApproved,false);
 assert.equal(result.disagreement,true);
 assert.equal(result.positions.find(p=>p.role==='Skeptic').position,'hold');
 assert.equal(result.positions.find(p=>p.role==='Skeptic').unknowns[0],'independent-review-not-observed');
 assert.equal(result.independentExecutionProven,false);
 assert.equal(result.perRole.length,7);
 assert.throws(()=>collectCouncilAssessments(shared,[...assessments,assessments[0]]),/duplicate-role/);
 assert.throws(()=>collectCouncilAssessments(shared,assessments.map((a,i)=>
  i===0?{...a,caseSha:'0'.repeat(64)}:a)),/case-mismatch/);
});


test('C04: registration blueprints expose seven SME lenses and one shared lifecycle',()=>{
 const script=process.execPath;
 const run=spawnSync(script,['scripts/council-app-manifests.mjs','--profile=collaborative-sme'],
  {encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const obj=JSON.parse(run.stdout);
 assert.equal(obj.permissionProfile,'collaborative-sme');
 assert.equal(obj.sharedCaseSchema,'ultron.council.shared-case.v1');
 assert.deepEqual(obj.sharedLifecycle,COUNCIL_LIFECYCLE);
 assert.equal(obj.apps.length,7);
 assert.equal(new Set(obj.apps.map(x=>x.expertise.domain)).size,7);
 assert.ok(obj.apps.every(x=>x.expertise.evidenceQuestions.length>=2));
 assert.equal(new Set(obj.apps.map(x=>JSON.stringify(x.manifest.default_permissions))).size,1);
 assert.equal(obj.registrationStatus,'NOT_REGISTERED');
});
