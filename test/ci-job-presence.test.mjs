import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyVerifyRun,expectedVerifyJobs,isServiceSideError,
  ATTESTED_PR_AUTHORS,VERIFY_WORKFLOW} from '../src/ci-job-presence.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const HEAD='79fb154f96285127f2749a1ff689a7198274ddea';
const pr={head:{sha:HEAD,repo:{full_name:REPO}},user:{login:'michaeljwilliams0123',id:308995719}};
const run=(x={})=>({id:42673201398,name:VERIFY_WORKFLOW.name,path:VERIFY_WORKFLOW.path,
  event:'pull_request',status:'completed',conclusion:'failure',head_sha:HEAD,run_attempt:1,...x});
const job=(name,conclusion='success',x={})=>({name,status:'completed',conclusion,run_attempt:1,...x});
const page=list=>({total_count:list.length,jobs:list});
const ISE='Internal server error. Correlation ID: 05a0b91b-ee00-411d-8ba9-df8959401404';

test('#350 red run: test+attested green, fixed-comparison never created => unknown-missing, never green',()=>{
  const x=classifyVerifyRun({run:run(),pullRequest:pr,annotations:[ISE],
    jobs:page([job('test'),job('attested-receipt')])});
  assert.equal(x.state,'unknown-missing');
  assert.deepEqual([...x.missing],['fixed-comparison']);
  assert.deepEqual([...x.failed],[]);
  assert.equal(x.serviceError,true);
  assert.equal(x.recovery,'rerun-entire-workflow-on-same-head');
});
test('zero-job and root-job-missing runs are unknown-missing, not test failures',()=>{
  const zero=classifyVerifyRun({run:run(),pullRequest:pr,jobs:page([])});
  assert.equal(zero.state,'unknown-missing');
  assert.deepEqual([...zero.missing],['test','fixed-comparison','attested-receipt']);
  const noTest=classifyVerifyRun({run:run(),pullRequest:pr,
    jobs:page([job('attested-receipt','skipped')])});
  assert.equal(noTest.state,'unknown-missing');
  assert.deepEqual([...noTest.skipped],['attested-receipt']);
});
test('known-good #352 shape is green only when every expected job exists and succeeds',()=>{
  const x=classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt')])});
  assert.equal(x.state,'green');
  assert.equal(x.recovery,null);
  // run-name makes the API `name` the PR title; identity is the workflow path.
  assert.equal(classifyVerifyRun({run:run({conclusion:'success',name:'fix(ci): some PR title'}),
    pullRequest:pr,jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt')])}).state,'green');
  // Aggregate success cannot hide a missing or skipped required job.
  assert.equal(classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test'),job('attested-receipt')])}).state,'unknown-missing');
  assert.equal(classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test'),job('fixed-comparison','skipped'),job('attested-receipt')])}).state,'unknown-missing');
  // Aggregate failure with all jobs green is unexplained, not green.
  assert.equal(classifyVerifyRun({run:run(),pullRequest:pr,
    jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt')])}).state,'unknown-missing');
});
test('a real job failure stays red; in-flight runs stay pending',()=>{
  const red=classifyVerifyRun({run:run(),pullRequest:pr,
    jobs:page([job('test','failure'),job('attested-receipt','skipped')])});
  assert.equal(red.state,'red');
  assert.deepEqual([...red.failed],['test']);
  assert.equal(classifyVerifyRun({run:run({status:'in_progress',conclusion:null}),pullRequest:pr,
    jobs:page([job('test','success'),job('fixed-comparison',null,{status:'in_progress'})])}).state,'pending');
});
test('attestation is expected only for same-repo trusted authors, matching verify.yml',()=>{
  assert.deepEqual(expectedVerifyJobs({event:'push'}),['test','attested-receipt']);
  assert.deepEqual(expectedVerifyJobs({event:'workflow_dispatch'}),['test']);
  assert.deepEqual(expectedVerifyJobs({event:'pull_request',pullRequest:{...pr,
    user:{login:'michaeljwilliams0123',id:1}}}),['test','fixed-comparison']);
  assert.deepEqual(expectedVerifyJobs({event:'pull_request',pullRequest:{...pr,
    head:{sha:HEAD,repo:{full_name:'fork/Ultron.MW'}}}}),['test','fixed-comparison']);
  assert.equal(expectedVerifyJobs({event:'issue_comment'}),null);
  // Fork/untrusted PR legitimately skips attestation and can still be green.
  const fork={...pr,head:{sha:HEAD,repo:{full_name:'fork/Ultron.MW'}}};
  assert.equal(classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:fork,
    jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt','skipped')])}).state,'green');
});
test('untrusted or partial input never proves presence or absence',()=>{
  const jobs=page([job('test'),job('fixed-comparison'),job('attested-receipt')]);
  for(const bad of [
    {run:run({path:'.github/workflows/reef-runtime-probe.yml'}),pullRequest:pr,jobs},
    {run:run({head_sha:'x'}),pullRequest:pr,jobs},
    {run:run(),pullRequest:{...pr,head:{...pr.head,sha:'b'.repeat(40)}},jobs},
    {run:run(),pullRequest:pr,jobs:{total_count:4,jobs:jobs.jobs}},
    {run:run({event:'issue_comment'}),pullRequest:pr,jobs},
  ])assert.equal(classifyVerifyRun(bad).state,'invalid');
  // Jobs from an earlier attempt do not satisfy the current attempt.
  assert.equal(classifyVerifyRun({run:run({run_attempt:2,conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt')])}).state,'unknown-missing');
  assert.equal(isServiceSideError(['Node.js 20 is deprecated']),false);
  assert.equal(isServiceSideError([ISE]),true);
});

// CI coverage for expected job presence and non-skipped conditions (#351 AC3):
// if verify.yml's job graph, conditions, or trust gate drifts, this fails.
const workflow=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
function jobBlocks(text){
  const body=text.slice(text.indexOf('\njobs:\n')+7);
  const blocks={};let name=null;
  for(const line of body.split('\n')){
    const m=/^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if(m){name=m[1];blocks[name]='';}
    else if(name)blocks[name]+=line+'\n';
  }
  return blocks;
}
test('verify.yml defines exactly the jobs the presence classifier expects, with intact conditions',()=>{
  assert.match(workflow,/^name: Ultron core verification$/m);
  assert.match(workflow,/pull_request:\n\s+types: \[opened, reopened, synchronize, edited\]/);
  const jobs=jobBlocks(workflow);
  assert.deepEqual(Object.keys(jobs).sort(),[...VERIFY_WORKFLOW.jobs].sort());
  // test: unconditional root job, exact-head checkout.
  assert.doesNotMatch(jobs.test,/^    (if|needs):/m);
  assert.match(jobs.test,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(jobs.test,/node scripts\/verify\.mjs/);
  // fixed-comparison: root job that always runs on pull_request, exact head and base.
  assert.doesNotMatch(jobs['fixed-comparison'],/^    needs:/m);
  assert.match(jobs['fixed-comparison'],/^    if: github\.event_name == 'pull_request'\n/m);
  assert.match(jobs['fixed-comparison'],/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(jobs['fixed-comparison'],/check-protected-issue-closures\.mjs/);
  assert.match(jobs['fixed-comparison'],/compare-acceptance-evidence\.mjs "\$BASE_SHA" "\$CANDIDATE_SHA"/);
  assert.match(jobs['fixed-comparison'],/^    permissions:\n      contents: read\n    steps:/m);
  // attested-receipt: needs test, same-repo trust gate, OIDC attestation.
  assert.match(jobs['attested-receipt'],/^    needs: test$/m);
  assert.match(jobs['attested-receipt'],/needs\.test\.result == 'success'/);
  assert.match(jobs['attested-receipt'],/head\.repo\.full_name == github\.repository/);
  for(const {login,id} of ATTESTED_PR_AUTHORS)
    assert.match(jobs['attested-receipt'],new RegExp(
      "user\\.login == '"+login+"' &&\\s+github\\.event\\.pull_request\\.user\\.id == "+id+'\\)'));
  assert.equal((jobs['attested-receipt'].match(/user\.login == /g)||[]).length,ATTESTED_PR_AUTHORS.length);
  assert.match(jobs['attested-receipt'],/id-token: write/);
  assert.match(jobs['attested-receipt'],/uses: actions\/attest@[a-f0-9]{40}/);
  // Top-level permissions stay read-only.
  assert.match(workflow,/^permissions:\n  contents: read\njobs:/m);
});

// Skeptic review of #401 (refs #401).
const STALE='b'.repeat(40);
test('Skeptic L4: a run on a stale head is reported invalid/staleHead, and the CLI never rewrites the PR head',()=>{
  const x=classifyVerifyRun({run:run({head_sha:STALE,conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test'),job('fixed-comparison'),job('attested-receipt')])});
  assert.equal(x.state,'invalid');
  assert.equal(x.staleHead,true);
  assert.equal(x.headSha,STALE);
  assert.equal(x.pullRequestHeadSha,HEAD);
  const cli=readFileSync(new URL('../scripts/ci-job-presence.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(cli,/sha:\s*run\.head_sha/);
  assert.doesNotMatch(cli,/pullRequest\s*=\s*\{\s*\.\.\.pullRequest/);
  assert.match(cli,/process\.exitCode=result\.state==='green'\?0:1/);
});
test('Skeptic L5: green requires success for every expected job, unique names, and an exact attempt',()=>{
  const ok=[job('test'),job('fixed-comparison'),job('attested-receipt')];
  for(const c of ['neutral',null,'stale','success '])
    assert.notEqual(classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,
      jobs:page([job('test',c),job('fixed-comparison'),job('attested-receipt')])}).state,'green',String(c));
  // Duplicate names fail closed in either order.
  for(const list of [[job('test','failure'),...ok],[...ok,job('test','failure')],[...ok,job('test')]]){
    const x=classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,jobs:page(list)});
    assert.equal(x.state,'invalid');
    assert.match(x.reason,/duplicate job name test/);
  }
  // Earlier-attempt jobs with the same name are not duplicates of the current attempt.
  assert.equal(classifyVerifyRun({run:run({run_attempt:2,conclusion:'success'}),pullRequest:pr,
    jobs:page([job('test','failure'),...ok.map(j=>({...j,run_attempt:2}))])}).state,'green');
  // undefined run_attempt never matches.
  const undef=ok.map(j=>({...j,run_attempt:undefined}));
  assert.equal(classifyVerifyRun({run:run({run_attempt:2,conclusion:'success'}),pullRequest:pr,
    jobs:page(undef)}).state,'unknown-missing');
  assert.equal(classifyVerifyRun({run:run({run_attempt:undefined,conclusion:'success'}),pullRequest:pr,
    jobs:page(undef)}).state,'invalid');
  assert.equal(classifyVerifyRun({run:run({conclusion:'success'}),pullRequest:pr,jobs:page(ok)}).state,'green');
});
