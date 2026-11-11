import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LANES,LEGACY_WORKFLOWS,laneFiles,checkParity,scanWorkflow,cutoverFileCount}
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

test('every legacy workflow job maps to exactly one consolidated lane, and every pin is real',()=>{
  const parity=checkParity({readFile:read,listWorkflows:list,listStaged:staged});
  assert.deepEqual(parity.problems,[]);
  assert.equal(parity.legacyCount,26);
  assert.equal(parity.laneCount,8);
  const keys=parity.mapped.map(m=>m.workflow+'#'+m.job);
  assert.equal(new Set(keys).size,keys.length,'a legacy job is mapped twice');
  assert.equal(keys.length,LEGACY_WORKFLOWS.reduce((n,w)=>n+w.jobs.length,0));
});

test('parity check catches an unmapped workflow, a drifted job and a removed pin',()=>{
  const files=[...list(),'new-thing.yml'];
  const drifted=path=>path.endsWith('reef-runtime-probe.yml')?
    read(path).replace('  reef-runtime-probe:','  reef-runtime-probe-2:'):
    path.endsWith('council-oidc.js')?'':read(path);
  const parity=checkParity({readFile:drifted,listWorkflows:()=>files,listStaged:staged});
  assert.ok(parity.problems.includes('unmapped legacy workflow new-thing.yml'));
  assert.ok(parity.problems.some(p=>p.startsWith('reef-runtime-probe.yml: jobs drifted')));
  assert.ok(parity.problems.some(p=>p.startsWith('owner-comment-router.yml: pin no longer present')));
});

test('lanes are owned by distinct Council roles (seven members plus Ultron Core)',()=>{
  const owners=Object.values(LANES).map(l=>l.owner);
  assert.equal(new Set(owners).size,8);
  for(const owner of owners)assert.ok(owner==='Ultron Core'||COUNCIL_APP_ROLES.includes(owner),owner);
  for(const role of COUNCIL_APP_ROLES)assert.ok(owners.includes(role),role+' owns no lane');
});

test('phase 1 lane workflows are shadow-only: no side-effect triggers, no writes, no required-check names',()=>{
  for(const file of laneFiles()){
    const source=laneSource(file);
    const scan=scanWorkflow(source);
    assert.match(scan.name,/\(shadow, /,file);
    const allowed=file==='lane-ops-audit.yml'?['workflow_dispatch','schedule']:['workflow_dispatch'];
    assert.deepEqual(scan.triggers,allowed,file+' triggers');
    assert.deepEqual(scan.jobs,['shadow'],file);
    assert.ok(scan.permissions.every(p=>!p.endsWith(':write')),file+' must not request write');
    assert.doesNotMatch(source,/^\s+test:\s*$/m,file+' must not define a job named test');
    assert.doesNotMatch(source,/secrets\.(?!GITHUB_TOKEN\b)/,file+' must not read repository secrets');
    assert.doesNotMatch(source,/pull_request_target|workflow_run|issue_comment|continue-on-error/,file);
    assert.match(source,/node scripts\/workflow-shadow\.mjs --lane /,file);
    // Staged lanes must already satisfy the repository-wide workflow rules.
    assert.match(source,/- name: Configure Git bare-repository policy\n        run: git config --global safe\.bareRepository explicit\n      - uses: actions\/checkout@[a-f0-9]{40}/,file);
    assert.match(source,/persist-credentials: false/,file);
    for(const [,action] of source.matchAll(/\buses:\s*([^\s#]+)/g))assert.match(action,/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,file);
  }
});

test('legacy workflows are untouched: required check `test` still lives only in verify.yml',()=>{
  assert.deepEqual(scanWorkflow(read('.github/workflows/verify.yml')).jobs,
    ['test','attested-receipt','fixed-comparison']);
  assert.match(read('.github/workflows/verify.yml'),/^name: Ultron core verification$/m);
});

test('Hatchable trust pins mean 11 files remain unless Hatchable pins are updated, 8 if they are',()=>{
  assert.equal(cutoverFileCount(),11);
  assert.equal(cutoverFileCount({hatchablePinsUpdated:true}),8);
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
