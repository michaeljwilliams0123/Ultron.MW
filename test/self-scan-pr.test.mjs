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
function github({landedFile=null,orphanBranch=false}={}) {
  const state={main:MAIN,branch:null,branchSha:null,branchFile:null,landedFile,
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
    if(path.startsWith(ROOT+'/git/ref/heads/')){
      if(orphanBranch && !state.branch){
        state.branch=path.slice((ROOT+'/git/ref/heads/').length);
        state.branchSha=MAIN;
        state.branchFile=state.landedFile;
      }
      return state.branch ? get(path):null;
    }
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
    if(state.branchFile || state.landedFile)
      assert.equal(body.sha,'d'.repeat(40));
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

test('ordinary source-tree inventory growth is not a material new finding',async()=>{
  const original=scanReport();
  const additionalFiles=scanReport({time:'2026-10-20T22:30:00Z'});
  additionalFiles.inventory={allFiles:129,source:40,tests:48,workflows:5};
  additionalFiles.uncertainty={...additionalFiles.uncertainty,
    sourceCoverage:original.uncertainty.sourceCoverage};
  assert.equal(selfScanSignature(original),selfScanSignature(additionalFiles));
  const mock=github();
  await publishSelfScanPr(args(mock,original));
  const reread=await publishSelfScanPr(args(mock,additionalFiles));
  assert.equal(reread.status,'already-open');
  assert.equal(mock.state.putCalls.length,1);
  assert.equal(mock.state.postCalls.filter(x=>x.path.endsWith('/pulls')).length,1);
});

test('source-evidence regression changes self-scan signature even if file count does not',()=>{
  const original=scanReport();
  const regressed=scanReport();
  regressed.evidence=[{...regressed.evidence[0],status:'missing',
    detail:'Native self-scan publisher route missing'}];
  assert.notEqual(selfScanSignature(original),selfScanSignature(regressed));
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

test('existing main report is updated with blob SHA rather than rejected HTTP 422',async()=>{
  const existing=renderScanReport(scanReport({weakness:'prior finding'}));
  const mock=github({landedFile:existing});
  const result=await publishSelfScanPr(args(mock));
  assert.equal(result.status,'created');
  assert.equal(mock.state.putCalls.length,1);
  assert.equal(mock.state.putCalls[0].body.sha,'d'.repeat(40));
  assert.equal(mock.state.postCalls.filter(x=>x.path===ROOT+'/git/refs').length,1);
});
test('orphan branch at exact main is safely resumed rather than wedging hourly scan',async()=>{
  const existing=renderScanReport(scanReport({weakness:'prior finding'}));
  const mock=github({landedFile:existing,orphanBranch:true});
  const result=await publishSelfScanPr(args(mock));
  assert.equal(result.status,'created');
  assert.equal(mock.state.postCalls.filter(x=>x.path===ROOT+'/git/refs').length,0);
  assert.equal(mock.state.putCalls[0].body.sha,'d'.repeat(40));
});


test('advanced orphan is preserved and a source-bound fallback publishes a PR',async()=>{
  const mock=github(), report=scanReport();
  const oldBranch=BRANCH+selfScanSignature(report).slice(0,16);
  const originalGetOptional=mock.getOptional;
  mock.getOptional=async path=>{
    if(path===ROOT+'/git/ref/heads/'+oldBranch)
      return {object:{sha:'e'.repeat(40)}};
    return originalGetOptional(path);
  };
  const r=await publishSelfScanPr(args(mock,report));
  assert.equal(r.status,'created');
  assert.equal(r.branch,oldBranch+'-'+MAIN.slice(0,12));
  assert.equal(mock.state.branch,r.branch);
  assert.equal(mock.state.postCalls.filter(x=>x.path===ROOT+'/git/refs').length,1);
  assert.equal(mock.state.postCalls.filter(x=>x.path===ROOT+'/pulls').length,1);
  assert.equal(mock.state.putCalls[0].body.branch,r.branch);
  assert.equal(mock.state.postCalls.filter(x=>x.path.includes('/issues')).length,0);
});

test('occupied fallback never overwrites old branch or publishes a PR',async()=>{
  const mock=github(), report=scanReport();
  const originalGetOptional=mock.getOptional;
  mock.getOptional=async path=>{
    if(path.startsWith(ROOT+'/git/ref/heads/'+BRANCH))
      return {object:{sha:'e'.repeat(40)}};
    return originalGetOptional(path);
  };
  await assert.rejects(()=>publishSelfScanPr(args(mock,report)),/fallback scan branch is occupied/);
  assert.equal(mock.state.postCalls.length,0);
  assert.equal(mock.state.putCalls.length,0);
});

// The committed report is a historical observation. Validate its own metadata,
// rather than comparing its inventory or authority to a later working tree.
const committedReport=await readFile(new URL('../'+SELF_SCAN_PATH,import.meta.url),'utf8');
function reportField(label,text=committedReport){
  const values=text.split('\n').filter(line=>line.startsWith(label+': '));
  assert.equal(values.length,1,'Expected one '+label+' field');
  return values[0].slice(label.length+2);
}

test('committed self-scan has a readable signature and complete source authority',()=>{
  const signature=reportField('Finding signature');
  assert.match(signature,/^[0-9a-f]{64}$/);
  assert.equal(reportSignature(committedReport),signature);
  for(const label of ['Observed GitHub main SHA','Observed source tree SHA']){
    assert.match(reportField(label),/^[0-9a-f]{40}$/);
  }
  const observedAt=reportField('Observed at');
  assert.match(observedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(observedAt).toISOString(),observedAt);
  assert.equal(reportField('Authority'),
    'exact GitHub main, not a deployed production runtime');
});

test('committed self-scan inventory contains consistent bounded integer counts',()=>{
  const counts=['Files inventoried','Source files','Test files','Workflow files']
    .map(label=>{
      const value=reportField('- '+label);
      assert.match(value,/^(0|[1-9][0-9]*)$/);
      const count=Number(value);
      assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=4096,label);
      return count;
    });
  const [allFiles,source,tests,workflows]=counts;
  assert.ok(allFiles>0,'The observation must inventory source files');
  assert.ok(source+tests+workflows<=allFiles,
    'Disjoint source, test and workflow counts must fit within the inventory');
});

test('committed CI observation has a known conclusion and canonical evidence link',()=>{
  const conclusion=reportField('- Observed current-main CI');
  assert.ok(['success','failure','cancelled','timed_out','action_required',
    'neutral','skipped','not-probed'].includes(conclusion));
  const runUrl=reportField('- GitHub CI evidence run');
  if(conclusion==='not-probed'){
    assert.equal(runUrl,'unavailable');
    return;
  }
  const url=new URL(runUrl);
  assert.equal(url.origin,'https://github.com');
  assert.equal(url.username,'');
  assert.equal(url.password,'');
  assert.equal(url.search,'');
  assert.equal(url.hash,'');
  const match=url.pathname.match(/^\/michaeljwilliams0123\/Ultron\.MW\/actions\/runs\/([1-9][0-9]*)$/);
  assert.ok(match,'CI evidence must identify an Actions run in the scanned repository');
  assert.ok(Number.isSafeInteger(Number(match[1])));
  assert.equal(runUrl,url.href);
});

test('committed static coverage agrees with the reported wiring checks',()=>{
  const coverage=Number(reportField('- Static evidence coverage'));
  assert.ok(Number.isFinite(coverage)&&coverage>=0&&coverage<=1);
  const match=committedReport.match(/^## Static wiring checks\n\n([\s\S]*?)\n\n## /m);
  assert.ok(match,'Expected a static wiring evidence section');
  const checks=match[1].split('\n');
  assert.ok(checks.length>0);
  for(const check of checks){
    assert.match(check,/^- [^\s:]+: (observed|missing)$/);
    if(coverage===1)assert.match(check,/: observed$/);
  }
  assert.equal(new Set(checks).size,checks.length,'Wiring checks must not be duplicated');
});

test('committed CI success and larger inventory do not attest live capabilities',()=>{
  for(const capability of ['Runtime','Provider','Production convergence']){
    assert.equal(reportField('- '+capability),'not-probed');
  }
  assert.equal(reportField('- Independent learning gain'),'not-established');
  assert.match(committedReport,/^\| high \| live-execution-unobserved \|/m);
  assert.match(committedReport,/^\| medium \| learning-effect-unobserved \|/m);
  assert.match(committedReport,/^This PR is a source scan, not a verified code fix\.$/m);
  assert.match(committedReport,/^Proposed repairs require separate tested implementation before closure\.$/m);
});

test('committed report signature is rejected when its envelope or digest is corrupted',async t=>{
  const signature=reportField('Finding signature');
  const cases=[
    ['missing marker',committedReport.replace(/^.*\n/,'')],
    ['unsupported marker',committedReport.replace('ULTRON_SELF_SCAN_REPORT_V1','ULTRON_SELF_SCAN_REPORT_V2')],
    ['short digest',committedReport.replace(signature,signature.slice(1))],
    ['long digest',committedReport.replace(signature,signature+'0')],
    ['non-hex digest',committedReport.replace(signature,'g'+signature.slice(1))],
    ['missing digest',committedReport.replace(/^Finding signature: .*\n/m,'')],
  ];
  for(const [name,text] of cases){
    await t.test(name,()=>assert.equal(reportSignature(text),null));
  }
});
