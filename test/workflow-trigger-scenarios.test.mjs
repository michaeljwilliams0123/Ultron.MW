import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {scanWorkflow,OIDC_JOBS} from '../src/workflow-consolidation.mjs';
import {prConversationAdmission,classifyLegacyFailure,laneConclusion} from '../src/workflow-lane-rules.mjs';

const dir=new URL('../.github/workflows/',import.meta.url);
const actual=readdirSync(dir).filter(x=>x.endsWith('.yml')).sort();
const source=name=>readFileSync(new URL(name,dir),'utf8');
const spec={
  'composio-v3.yml':{triggers:['workflow_dispatch'],jobs:['isolated-sdk']},
  'contract-validation.yml':{triggers:['pull_request','push','workflow_dispatch'],jobs:['validate']},
  'secret-isolation.yml':{triggers:['workflow_dispatch'],jobs:['source-secret-audit']},
  'cloud-pr.yml':{triggers:['workflow_call','issues'],jobs:['create-pr']},
  'council-debate.yml':{triggers:['issues','pull_request','workflow_call','workflow_dispatch'],jobs:['council-debate','prove','verify-principal']},
  'council-deep-reasoning.yml':{triggers:['workflow_dispatch'],jobs:['council-deep-reasoning']},
  'council-required-status.yml':{triggers:['pull_request_target','issue_comment','workflow_run','workflow_dispatch'],jobs:['trusted-council-status']},
  'lane-governed-task.yml':{triggers:['issues','workflow_dispatch'],jobs:['work']},
  'lane-lab-evidence.yml':{triggers:['workflow_dispatch'],jobs:['heldout-evaluation','cpu-evaluation','generate','publish','held-out']},
  'lane-ops-audit.yml':{triggers:['workflow_run','pull_request','schedule','workflow_dispatch'],jobs:['audit','self-scan-pr','mirror','reef-runtime-probe','diagnose','act','reconcile','council-hold-remediation','reap-stale-queued-runs']},
  'lane-owner-canary.yml':{triggers:['workflow_dispatch'],jobs:['read-only','one-branch','inspect-or-verify','marker-write','secondary-admin-verify','verify']},
  'owner-comment-router.yml':{triggers:['issue_comment','pull_request_review_comment','issues','workflow_dispatch'],jobs:['cloud','pr-conversation','issue-implementation','council-command','codex-trigger-audit','public-chat']},
  'release-authorize.yml':{triggers:['workflow_dispatch','workflow_run','schedule'],jobs:['authorize-release-receipt']},
  'universal-loop.yml':{triggers:['workflow_call','workflow_dispatch'],jobs:['prepare-list','execute-loop','recurse-next']},
  'verify.yml':{triggers:['push','pull_request','workflow_dispatch'],jobs:['test','attested-receipt','fixed-comparison']},
};
test('eight canonical lanes, Council gate and two manual verification utilities',()=>{
  assert.deepEqual(actual,Object.keys(spec).sort());
});
for(const [name,entry] of Object.entries(spec)){
  test(name+' retains exact event triggers and job IDs',()=>{
    const scanned=scanWorkflow(source(name));
    assert.deepEqual([...scanned.triggers].sort(),[...entry.triggers].sort());
    assert.deepEqual([...scanned.jobs].sort(),[...entry.jobs].sort());
    assert.match(source(name),/^permissions:\n  contents: read\n/m);
    assert.doesNotMatch(source(name),/runs-on:\s*self-hosted/i);
    assert.doesNotMatch(source(name),/runs-on:.*(?:SD009WC7|127\.0\.0\.1|localhost)/i);
  });
}
test('all active hosted jobs pin Ubuntu 24.04 instead of moving ubuntu-latest',()=>{
  for(const file of actual){
    const labels=[...source(file).matchAll(/^\s+runs-on:\s*(\S+)/gm)].map(x=>x[1]);
    for(const label of labels)assert.equal(label,'ubuntu-24.04',file+' uses '+label);
    assert.ok(labels.length>0||file==='cloud-pr.yml',file+' missing hosted runner');
  }
});
test('all workload identities retain narrow per-job OIDC allowlists',()=>{
  for(const name of actual){
    const body=source(name);
    const jobIds=scanWorkflow(body).jobs;
    const allow=new Set(OIDC_JOBS[name]||[]);
    for(let i=0;i<jobIds.length;i++){
      const job=jobIds[i];
      const start=body.indexOf('\n  '+job+':\n');
      assert.ok(start>=0,name+'#'+job);
      const end=i+1<jobIds.length?body.indexOf('\n  '+jobIds[i+1]+':\n',start+1):body.length;
      const block=body.slice(start,end>start?end:body.length);
      const hasOidc=/^\s+id-token:\s*write\s*$/m.test(block);
      assert.equal(hasOidc,allow.has(job),name+'#'+job+' unexpected OIDC grant');
    }
  }
});
test('Council release path preserves protected-main checkout and fails closed without its dedicated App',()=>{
  const s=source('council-required-status.yml');
  assert.match(s,/pull_request_target:/);
  assert.match(s,/ref: main\n/);
  assert.match(s,/COUNCIL_GATE_APP_CLIENT_ID/);
  assert.match(s,/COUNCIL_GATE_APP_PRIVATE_KEY/);
  assert.match(s,/Fail closed when the Council Gate App is not configured/);
  assert.doesNotMatch(s,/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha/);
});
test('owner canary is manually dispatched with read-only defaults and distinct write approval',()=>{
  const s=source('lane-owner-canary.yml');
  assert.match(s,/actions_mode:\n[\s\S]*?default: read/);
  assert.match(s,/matrix_mode:\n[\s\S]*?default: inspect/);
  assert.match(s,/connection_mode:\n[\s\S]*?default: read/);
  assert.match(s,/approval_phrase:/);
  assert.match(s,/github\.actor == 'michaeljwilliams0123'/);
});
test('self-repair cannot act without explicit enabled setting and diagnostic consent',()=>{
  const s=source('lane-ops-audit.yml');
  assert.match(s,/needs\.diagnose\.outputs\.act == 'true' && vars\.ULTRON_SELF_REPAIR_MODE == 'act'/);
  assert.match(s,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(s,/workflow_run:\n    workflows: \["Ultron core verification"\]/);
});
test('governed worker requires owner and pinned main branch for write-capable execution',()=>{
  const s=source('lane-governed-task.yml');
  assert.match(s,/github\.actor == 'michaeljwilliams0123'/);
  assert.match(s,/github\.ref == 'refs\/heads\/main'/);
  assert.match(s,/id-token: write/);
  assert.doesNotMatch(s,/workflow_call:/);
});
test('admission matrix cannot promote malformed, closed, foreign, unmarked or stale-sha PRs',()=>{
  const REPO='michaeljwilliams0123/Ultron.MW';
  let count=0,allowed=0;
  for(const branch of ['ultron/repair','feature/other'])
  for(const state of ['open','closed'])
  for(const baseRef of ['main','release'])
  for(const repo of [REPO,'foreign/Ultron.MW'])
  for(const sha of ['a'.repeat(40),'bad-sha'])
  for(const marked of [true,false]){
    const p={number:31,state,body:marked?'## Ultron issue #31':'untrusted issue text',
      base:{ref:baseRef,repo:{full_name:REPO}},
      head:{ref:branch,sha,repo:{full_name:repo}}};
    const admit=prConversationAdmission(p,{number:31}).admit;
    const valid=branch==='ultron/repair'&&state==='open'&&baseRef==='main'&&repo===REPO&&sha.length===40&&marked;
    assert.equal(admit,valid,JSON.stringify({branch,state,baseRef,repo,sha,marked}));
    if(admit)allowed++;
    count++;
  }
  assert.equal(count,64);
  assert.equal(allowed,1);
});
test('historical incident matrix never turns unknown failures into success',()=>{
  let count=0;
  for(const file of actual)
  for(const incident of [
    {log:'unknown exception in runner',jobCount:1,expected:'red'},
    {log:'HTTP 403 permission denied',jobCount:1,expected:'red'},
    {log:'lost communication with the server',jobCount:1,expected:'rerun'},
    {log:'Internal server error',jobCount:1,expected:'rerun'},
    {log:'job created without jobs',jobCount:0,expected:'rerun'},
    {log:'unverified passkey required',jobCount:1,expected:'red'},
  ]){
    const result=classifyLegacyFailure({workflow:file,log:incident.log,jobCount:incident.jobCount});
    assert.equal(result.projected,incident.expected,file+': '+incident.log);
    count++;
  }
  assert.equal(count,actual.length*6);
});
test('outcome reducer keeps every real failure red across all three-job permutations',()=>{
  const values=['red','admitted','success','neutral','skipped'];
  let count=0;
  for(const a of values)for(const b of values)for(const c of values){
    const input=[a,b,c];
    const expected=input.includes('red')?'failure':
      (input.includes('admitted')||input.includes('success'))?'success':'neutral';
    assert.equal(laneConclusion(input),expected);
    count++;
  }
  assert.equal(count,125);
});
