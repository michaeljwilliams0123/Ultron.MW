import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publishSelfScanPr, selfScanSignature, renderScanReport,
  reportSignature, SELF_SCAN_MARKER, SELF_SCAN_PATH } from '../src/self-scan-pr.mjs';
import { createCloudTaskUrl } from '../docs/core/cloud-submit.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const MAIN='a'.repeat(40), TREE='b'.repeat(40), NEW='c'.repeat(40);
const BRANCH='ultron/self-scan-';
const REPORT_PATH=ROOT+'/contents/'+SELF_SCAN_PATH;
function scanReport({weakness='runtime untested',time='2026-10-19T21:00:00Z'}={}) {
  return {
    schema:'ultron.self-model.v1',environment:'cloud',observedAt:time,
    sourceAuthority:{commitSha:MAIN,treeSha:TREE},
    identity:{name:'Ultron.MW'}, inventory:{allFiles:70,source:20,tests:25,workflows:4},
    evidence:[{kind:'static-route-link',sourcePath:'src/self-scan-pr.mjs',
      status:'observed',detail:'Native self-scan publisher present'}],
    weaknesses:[{code:'execution-unverified',priority:'high',detail:weakness,
      repair:'Validate authenticated live execution'}],
    nextActions:['Validate authenticated live execution'],
    uncertainty:{sourceCoverage:1,operationalReadiness:'not-probed',
      providerReadiness:'not-probed',productionConvergence:'not-probed',
      independentLearningGain:'not-established'},
  };
}
function github() {
  const state={main:MAIN,branch:null,branchSha:null,branchFile:null,landedFile:null,
    pr:null,postCalls:[],putCalls:[],getCalls:[]};
  const file=text=>text?{sha:'d'.repeat(40),encoding:'base64',
    content:Buffer.from(text).toString('base64')}:null;
  const get=async path=>{
    state.getCalls.push(path);
    if(path===ROOT+'/git/ref/heads/main')return {object:{sha:state.main}};
    if(path.startsWith(ROOT+'/git/ref/heads/')){
      if(!state.branch || path!==ROOT+'/git/ref/heads/'+state.branch)throw Error('missing branch');
      return {object:{sha:state.branchSha}};
    }
    if(path===ROOT+'/pulls?state=open&per_page=100')return state.pr?[state.pr]:[];
    if(state.pr && path===ROOT+'/pulls/'+state.pr.number)return state.pr;
    if(path.startsWith(REPORT_PATH+'?ref=')){
      const ref=decodeURIComponent(path.split('?ref=')[1]);
      const text=ref===state.main?state.landedFile:
        ref===state.branch?state.branchFile:null;
      if(!text)throw Error('missing report');
      return file(text);
    }
    throw Error('Unexpected GET '+path);
  };
  const getOptional=async path=>{
    if(path.startsWith(REPORT_PATH+'?ref=')){
      const ref=decodeURIComponent(path.split('?ref=')[1]);
      return file(ref===state.main?state.landedFile:
        ref===state.branch?state.branchFile:null);
    }
    if(path.startsWith(ROOT+'/git/ref/heads/'))
      return state.branch ? get(path):null;
    throw Error('Unexpected GET optional '+path);
  };
  const post=async(path,body)=>{
    state.postCalls.push({path,body});
    if(path===ROOT+'/git/refs'){
      state.branch=body.ref.replace('refs/heads/','');
      state.branchSha=body.sha;
      assert.equal(body.sha,state.main);
      return {ref:body.ref};
    }
    if(path===ROOT+'/pulls'){
      assert.equal(body.base,'main');
      assert.equal(body.head,state.branch);
      state.pr={number:45,state:'open',html_url:'https://github.com/'+REPO+'/pull/45',
        head:{ref:body.head,sha:state.branchSha,repo:{full_name:REPO}},
        base:{ref:body.base,repo:{full_name:REPO}},body:body.body};
      return state.pr;
    }
    if(path===ROOT+'/actions/workflows/verify.yml/dispatches'){
      assert.equal(body.ref,state.branch);
      return {};
    }
    throw Error('Unexpected POST '+path);
  };
  const put=async(path,body)=>{
    state.putCalls.push({path,body});
    assert.equal(path,REPORT_PATH);
    assert.equal(body.branch,state.branch);
    if(state.branchFile)assert.equal(body.sha,'d'.repeat(40));
    else assert.equal(body.sha,undefined);
    state.branchFile=Buffer.from(body.content,'base64').toString('utf8');
    state.branchSha=NEW;
    if(state.pr)state.pr.head.sha=NEW;
    return {commit:{sha:NEW}};
  };
  return {state,get,getOptional,post,put};
}
function args(mock,report=scanReport()){
  return {repository:REPO,eventName:'workflow_dispatch',actor:'michaeljwilliams0123',
    executorSha:MAIN,get:mock.get,getOptional:mock.getOptional,
    post:mock.post,put:mock.put,scan:async()=>report};
}

test('Self scan and slash command handoff open Actions workflow, not Issues',async()=>{
  for(const phrase of ['/self scan','scan yourself']) {
    const url=new URL(createCloudTaskUrl(phrase));
    assert.equal(url.pathname,'/michaeljwilliams0123/Ultron.MW/actions/workflows/self-scan-pr.yml');
    assert.ok(!url.pathname.includes('/issues'));
    assert.equal(url.searchParams.has('token'),false);
  }
  assert.throws(()=>createCloudTaskUrl('scan yourself and inspect repo'),/separately/);
  const app=await readFile(new URL('../docs/app.js',import.meta.url),'utf8');
  const legacy=await readFile(new URL('../.github/workflows/cloud-objective.yml',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../.github/workflows/self-scan-pr.yml',import.meta.url),'utf8');
  assert.match(app,/Self-scan/);
  assert.doesNotMatch(legacy,/cron:/);
  assert.match(workflow,/cron: '17 \* \* \* \*'/);
  assert.match(workflow,/pull-requests: write/);
  assert.doesNotMatch(workflow,/issues: write/);
});

test('material findings publish one verified PR to main with no Issue write',async()=>{
  const mock=github();
  const r=await publishSelfScanPr(args(mock));
  assert.equal(r.status,'created');
  assert.equal(r.base,'main');
  assert.equal(r.prNumber,45);
  assert.ok(r.branch.startsWith(BRANCH));
  assert.equal(mock.state.pr.base.ref,'main');
  assert.ok(mock.state.pr.body.startsWith(SELF_SCAN_MARKER));
  assert.equal(reportSignature(mock.state.branchFile),r.signature);
  assert.match(mock.state.branchFile,/Observed GitHub main SHA: a{40}/);
  assert.ok(mock.state.postCalls.every(x=>!x.path.includes('/issues')));
  assert.equal(mock.state.postCalls.filter(x=>x.path.endsWith('/pulls')).length,1);
  assert.equal(mock.state.postCalls.filter(x=>x.path.endsWith('/dispatches')).length,1);
});

test('identical findings do not create duplicate PR or write on hourly rescan',async()=>{
  const mock=github(),initial=scanReport();
  await publishSelfScanPr(args(mock,initial));
  const before={post:mock.state.postCalls.length,put:mock.state.putCalls.length};
  const duplicate=await publishSelfScanPr(args(mock,scanReport({time:'2026-10-19T22:00:00Z'})));
  assert.equal(duplicate.status,'already-open');
  assert.equal(mock.state.postCalls.length,before.post);
  assert.equal(mock.state.putCalls.length,before.put);
  mock.state.landedFile=mock.state.branchFile;
  const landed=await publishSelfScanPr(args(mock,initial));
  assert.equal(landed.status,'unchanged');
  assert.equal(mock.state.postCalls.length,before.post);
});

test('new material findings update existing PR, not create additional PRs',async()=>{
  const mock=github();
  const first=await publishSelfScanPr(args(mock));
  const updated=await publishSelfScanPr(args(mock,
    scanReport({weakness:'New missing routing proof'})));
  assert.equal(updated.status,'updated');
  assert.equal(updated.prNumber,first.prNumber);
  assert.equal(mock.state.putCalls.length,2);
  assert.equal(mock.state.postCalls.filter(x=>x.path.endsWith('/pulls')).length,1);
  assert.notEqual(updated.signature,first.signature);
  assert.equal(reportSignature(mock.state.branchFile),updated.signature);
});

test('stale authority, foreign actor, incomplete report and stray branches make no writes',async()=>{
  const cases=[
    {modify:(a)=>({...a,actor:'attacker'})},
    {modify:(a)=>({...a,repository:'someone/other'})},
    {modify:(a)=>({...a,executorSha:'f'.repeat(40)})},
    {modify:(a)=>({...a,scan:async()=>({schema:'ultron.self-model.v1'})})},
  ];
  for(const {modify} of cases){
    const mock=github();
    await assert.rejects(()=>publishSelfScanPr(modify(args(mock))));
    assert.equal(mock.state.postCalls.length,0);
    assert.equal(mock.state.putCalls.length,0);
  }
  const stale=github();stale.state.main='f'.repeat(40);
  await assert.rejects(()=>publishSelfScanPr(args(stale)),/Main changed/);
  assert.equal(stale.state.postCalls.length,0);
});

test('scan signatures bind material evidence, not wall-clock time',()=>{
  const same=selfScanSignature(scanReport({time:'2026-10-19T01:00:00Z'}));
  assert.equal(same,selfScanSignature(scanReport({time:'2026-10-19T20:00:00Z'})));
  assert.notEqual(same,selfScanSignature(scanReport({weakness:'different'})));
  assert.equal(reportSignature(renderScanReport(scanReport())),same);
  assert.equal(reportSignature('this is not a scan'),null);
});
