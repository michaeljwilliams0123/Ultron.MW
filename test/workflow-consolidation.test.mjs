import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LANES,LEGACY_WORKFLOWS,laneFiles,checkParity,scanWorkflow,cutoverFileCount,OIDC_JOBS}
  from '../src/workflow-consolidation.mjs';
import {prConversationAdmission,classifyLegacyFailure,laneConclusion}
  from '../src/workflow-lane-rules.mjs';
import {handlePrConversation} from '../src/pr-brain.mjs';
import {replayLane,renderSummary} from '../scripts/workflow-shadow.mjs';
import {COUNCIL_APP_ROLES} from '../src/council-app-identities.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const list=()=>readdirSync(new URL('.github/workflows/',root)).filter(n=>/\.ya?ml$/.test(n));
const staged=()=>{try{return readdirSync(new URL('.github/workflow-lanes/',root)).filter(n=>/\.ya?ml$/.test(n));}catch{return [];}};
const laneSource=file=>list().includes(file)?read('.github/workflows/'+file):read('.github/workflow-lanes/'+file);

const LEGACY_FILES=['verify.yml','reef-runtime-probe.yml','owner-comment-router.yml','codex-trigger-audit.yml',
  'inline-pr-chat.yml','pr-brain.yml','council-debate.yml','continuum-council-supervisor.yml',
  'council-identity-proof.yml','council-principal-proof.yml','owner-actions-canary.yml','owner-canary-matrix.yml',
  'mahoraga-connection1026.yml','hf-free-cpu-tournament.yml','hf-heldout-cpu.yml','hf-oidc-bridge.yml',
  'held-out-acceptance.yml','c06-owner-model-release.yml','c06-reconcile-publish.yml','live-acceptance-audit.yml',
  'self-scan-pr.yml','gitlab-mirror.yml','cloud-objective.yml','cloud-pr.yml','council-worker.yml',
  'governed-execution.yml','council-self-repair.yml'];

test('phase 2: exactly eight workflow files; every legacy job lives once in its lane; every pin is real',()=>{
  const parity=checkParity({readFile:read,listWorkflows:list,listStaged:staged});
  assert.deepEqual(parity.problems,[]);
  assert.equal(parity.legacyCount,27,'26 legacy files plus council-self-repair (#411)');
  assert.deepEqual(LEGACY_WORKFLOWS.map(w=>w.file).sort(),[...LEGACY_FILES].sort());
  assert.equal(parity.laneCount,8);
  const keys=parity.mapped.map(m=>m.lane+'#'+m.job);
  assert.equal(new Set(keys).size,keys.length,'a job is mapped twice');
  assert.deepEqual(list().filter(f=>f!=='council-required-status.yml').sort(),[...new Set(laneFiles())].sort());
  assert.equal(cutoverFileCount(),8);
  assert.deepEqual(staged(),[],'shadow lane copies are removed');
  assert.deepEqual(LEGACY_WORKFLOWS.filter(w=>w.disposition==='retired').map(w=>w.file).sort(),
    ['c06-reconcile-publish.yml','governed-execution.yml','hf-oidc-bridge.yml']);
});

test('parity check catches an unmapped workflow, a leftover legacy file, a lost job and a removed pin',()=>{
  const files=[...list(),'new-thing.yml','gitlab-mirror.yml'];
  const drifted=path=>path.endsWith('lane-ops-audit.yml')?
    read(path).replace('\n  reef-runtime-probe:','\n  reef-runtime-probe-2:'):
    path.endsWith('council-oidc.js')?'':read(path);
  const parity=checkParity({readFile:drifted,listWorkflows:()=>files,listStaged:staged});
  assert.ok(parity.problems.includes('unmapped workflow new-thing.yml'));
  assert.ok(parity.problems.includes('gitlab-mirror.yml: absorbed legacy workflow still present'));
  assert.ok(parity.problems.includes('reef-runtime-probe.yml: job reef-runtime-probe missing from lane-ops-audit.yml'));
  assert.ok(parity.problems.includes('lane-ops-audit.yml: unmapped job reef-runtime-probe-2'));
  assert.ok(parity.problems.some(p=>p.startsWith('owner-comment-router.yml: pin no longer present')));
});

test('lanes are owned by distinct Council roles (seven members plus Ultron Core)',()=>{
  const owners=Object.values(LANES).map(l=>l.owner);
  assert.equal(new Set(owners).size,8);
  for(const owner of owners)assert.ok(owner==='Ultron Core'||COUNCIL_APP_ROLES.includes(owner),owner);
  for(const role of COUNCIL_APP_ROLES)assert.ok(owners.includes(role),role+' owns no lane');
});

test('required check `test` is still produced only by verify.yml, unchanged',()=>{
  assert.deepEqual(scanWorkflow(read('.github/workflows/verify.yml')).jobs,
    ['test','attested-receipt','fixed-comparison']);
  assert.match(read('.github/workflows/verify.yml'),/^name: Ultron core verification$/m);
  for(const file of list().filter(f=>f!=='verify.yml'))
    assert.doesNotMatch(read('.github/workflows/'+file),/^  test:\s*$/m,file+' must not define a job named test');
});

test('every moved job keeps its original trigger behind a job-level gate',()=>{
  const gated={'lane-lab-evidence.yml':/inputs\.lab_task == /,'lane-owner-canary.yml':/inputs\.canary_task == /,
    'lane-ops-audit.yml':/github\.event_name == /,'lane-governed-task.yml':/github\.event_name == /};
  for(const [file,gate] of Object.entries(gated)){
    const yml=read('.github/workflows/'+file);
    for(const job of scanWorkflow(yml).jobs){
      const body=yml.split('\n  '+job+':\n')[1].split(/\n  [A-Za-z0-9_-]+:\n/)[0];
      assert.match(body,/^    if: >-/m,file+'#'+job+' has no gate');
      assert.match(body,gate,file+'#'+job);
      assert.match(body,/^    permissions:/m,file+'#'+job+' must declare its own permissions');
    }
    assert.match(yml,/^permissions:\n  contents: read\njobs:/m,file+' workflow default must stay read-only');
  }
});

const SHA='a'.repeat(40);
const REPO='michaeljwilliams0123/Ultron.MW';
const pr=(over={})=>({number:7,state:'open',body:'plain body',base:{ref:'main',repo:{full_name:REPO}},
  head:{ref:'ultron/self-scan-x',sha:SHA,repo:{full_name:REPO}},...over});
const event={action:'created',issue:{number:7,pull_request:{}},comment:{id:9,user:{login:'michaeljwilliams0123'},body:'@ultron status'}};

test('lane admission agrees with pr-brain on admitted, unadmitted, unmanaged and closed PRs',async()=>{
  const cases=[pr(),pr({body:'<!-- ULTRON_SELF_SCAN_PR_V1 -->\nx'}),pr({head:{ref:'feat/x',sha:SHA,repo:{full_name:REPO}}}),
    pr({state:'closed'}),pr({head:{ref:'ultron/framework-a',sha:SHA,repo:{full_name:REPO}}})];
  for(const fixture of cases){
    const lane=prConversationAdmission(fixture,{number:7});
    let brain;
    try{
      brain=await handlePrConversation({event,eventName:'issue_comment',actor:'michaeljwilliams0123',repository:REPO,
        get:async path=>{if(path.endsWith('/pulls/7'))return fixture;throw Error('stop-after-admission');},
        post:async()=>{},patch:async()=>{}});
    }catch(e){brain={error:e.message};}
    if(lane.status==='skipped-unadmitted')assert.equal(brain.error,'Unadmitted PR cannot access Ultron brain');
    else if(lane.admit)assert.notEqual(brain.error,'Unadmitted PR cannot access Ultron brain');
    else assert.equal(brain.status,lane.status);
  }
});

test('lane rules turn no-op failures into skip/neutral and keep real failures red',()=>{
  assert.equal(classifyLegacyFailure({workflow:'owner-comment-router.yml',jobCount:3,
    log:'Ultron PR brain rejected: Unadmitted PR cannot access Ultron brain'}).projected,'skipped');
  assert.equal(classifyLegacyFailure({workflow:'codex-trigger-audit.yml',jobCount:1,
    log:'C03 trigger admission not established; no executor claim, retry, or success.'}).projected,'neutral');
  assert.equal(classifyLegacyFailure({workflow:'verify.yml',jobCount:0}).projected,'rerun');
  assert.equal(classifyLegacyFailure({workflow:'verify.yml',jobCount:3,log:'not ok 12 - x'}).projected,'red');
  assert.equal(laneConclusion(['skipped','neutral']),'neutral');
  assert.equal(laneConclusion(['red','admitted']),'failure');
});

test('shadow replay only issues reads and reports projected lane outcomes',async()=>{
  const calls=[];
  const get=async(path,opts)=>{
    calls.push(path);
    if(path.includes('/workflows/codex-trigger-audit.yml/runs'))
      return {workflow_runs:[{id:1,conclusion:'failure',html_url:'u1'},{id:2,conclusion:'skipped'}]};
    if(path.includes('/workflows/'))return {workflow_runs:[]};
    if(path.endsWith('/jobs?filter=latest&per_page=100'))return {total_count:1,jobs:[{id:5,conclusion:'failure'}]};
    if(path.endsWith('/logs')&&opts?.text)return 'C03 trigger admission not established';
    throw Error('unexpected '+path);
  };
  const r=await replayLane('comment-router',{get,repo:REPO,since:'2026-11-01'});
  assert.equal(r.legacyRed,1);
  assert.equal(r.laneRed,0);
  assert.ok(calls.every(c=>!/rerun|dispatches|comments|labels/.test(c)));
  assert.match(renderSummary(checkParity({readFile:read,listWorkflows:list,listStaged:staged}),[r]),/Shadow mode: no comment/);
});

// Callers must not point at a deleted workflow file. Exceptions are explicit:
// the manifest itself, historical log classification, immutable historical run
// evidence and (until step 3) the
// Hatchable dual-trust transition pins.
const LEGACY_REFERENCE_ALLOWED=new Map([
  ['src/workflow-consolidation.mjs','manifest'],
  ['src/workflow-lane-rules.mjs','historical log classification'],
  ['cloud/hatchable/lib/c06-live-evidence.js','immutable historical run path'],
  ['cloud/hatchable/lib/council-oidc.js','dual-trust transition (removed in step 3)'],
  ['cloud/hatchable/lib/hf-github-receipts.js','dual-trust transition (removed in step 3)'],
  ['cloud/hatchable/lib/hf-lab-view.js','dual-trust transition (removed in step 3)'],
  ['cloud/hatchable/lib/heldout-evidence.js','dual-trust transition (removed in step 3)'],
  ['cloud/hatchable/lib/github-oidc-bridge.js','retired bridge (deleted in step 3)'],
]);
test('no runtime source references a deleted workflow file outside the explicit exceptions',()=>{
  const gone=LEGACY_WORKFLOWS.filter(w=>w.disposition!=='lane').map(w=>w.file);
  const pattern=new RegExp('(?:^|[^a-z0-9-])('+gone.map(f=>f.replace(/[.]/g,'\\.')).join('|')+')','m');
  const roots=['src','scripts','cloud/hatchable/lib','cloud/hatchable/api','cloud/hatchable/mcp',
    'cloud/hatchable/public','docs/core'];
  const files=[];
  const walk=dir=>{for(const e of readdirSync(new URL(dir+'/',root),{withFileTypes:true})){
    const p=dir+'/'+e.name;
    if(e.isDirectory())walk(p);else if(/\.(m?js|html)$/.test(e.name))files.push(p);}};
  for(const r of roots)walk(r);
  files.push('docs/app.js','docs/index.html');
  const hits=files.filter(f=>!LEGACY_REFERENCE_ALLOWED.has(f)&&pattern.test(read(f)))
    .map(f=>f+': '+read(f).match(pattern)[1]);
  assert.deepEqual(hits,[]);
});

// Skeptic M1: Hatchable trusts lane-governed-task.yml@main as the council
// worker. GitHub OIDC has no job claim, so that file must stay a dedicated
// single-job file that no other workflow can call, and id-token must stay on
// an explicit per-file job allowlist everywhere.
const jobBody=(yml,job)=>yml.split('\n  '+job+':\n')[1].split(/\n  [A-Za-z0-9_-]+:\n/)[0];
test('worker identity file is single-job, not reusable, and only listed jobs can mint OIDC',()=>{
  const worker=read('.github/workflows/lane-governed-task.yml');
  assert.deepEqual(scanWorkflow(worker).jobs,['work']);
  assert.doesNotMatch(worker,/^  workflow_call:/m);
  assert.deepEqual([...scanWorkflow(worker).triggers].sort(),['issues','workflow_dispatch']);
  assert.match(jobBody(worker,'work'),/github\.ref == 'refs\/heads\/main'/);
  assert.match(jobBody(worker,'work'),/github\.actor == 'michaeljwilliams0123'/);
  for(const file of list()){
    const yml=read('.github/workflows/'+file);
    assert.doesNotMatch(yml,/^permissions:[^\n]*\n(?:  [^\n]*\n)*?  id-token:/m,file+': no workflow-level id-token');
    const minting=scanWorkflow(yml).jobs.filter(job=>/^      id-token: write$/m.test(jobBody(yml,job)));
    assert.deepEqual(minting,OIDC_JOBS[file]||[],file);
  }
  for(const file of list())
    assert.ok(!read('.github/workflows/'+file).includes('uses: ./.github/workflows/lane-governed-task.yml'),file);
});

test('router reusable calls carry no ceiling beyond what the called jobs use (Skeptic L2)',()=>{
  const router=read('.github/workflows/owner-comment-router.yml');
  assert.doesNotMatch(jobBody(router,'cloud'),/id-token|actions: write/);
  const council=jobBody(router,'council-command');
  assert.doesNotMatch(council,/actions: write/);
  assert.doesNotMatch(read('.github/workflows/council-debate.yml'),/actions: write/);
});
