import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveMode,diagnoseRun,planRepair,selectStaleDrafts,planBranchUpdate,sanitizeLog,
  renderIssue,findIssueForSignature,issueMarker,ALLOWED_OPS} from '../src/council-self-repair.mjs';
import {OWNER_ONLY_OPERATIONS} from '../src/council-of-ultron.mjs';
import {handleRun,sweepDrafts,renderSummary} from '../scripts/council-self-repair.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const SHA='b'.repeat(40);
const owner={login:'michaeljwilliams0123',id:308995719};
const verifyRun=(over={})=>({id:11,run_attempt:1,path:'.github/workflows/verify.yml',name:'Ultron core verification',
  event:'push',head_branch:'main',head_sha:SHA,status:'completed',conclusion:'failure',
  head_repository:{full_name:REPO},...over});
const jobs=(list)=>({total_count:list.length,jobs:list});
const job=(name,conclusion,steps=[])=>({name,conclusion,status:'completed',run_attempt:1,steps});
const pr=(over={})=>({number:5,state:'open',draft:true,user:owner,base:{ref:'main',repo:{full_name:REPO}},
  head:{ref:'feat/x',sha:SHA,repo:{full_name:REPO}},updated_at:'2026-11-08T00:00:00Z',...over});

test('mode defaults to report-only for empty or unknown config',()=>{
  assert.equal(resolveMode(undefined),'report-only');
  assert.equal(resolveMode('yolo'),'report-only');
  assert.equal(resolveMode('ACT'),'act');
  assert.equal(resolveMode('off'),'off');
});

test('Sentinel: missing jobs on main is an outage that gets one whole-workflow rerun',()=>{
  const d=diagnoseRun({run:verifyRun({conclusion:'failure'}),jobs:jobs([])});
  assert.equal(d.category,'outage-missing-jobs');
  const p=planRepair(d,{mode:'act'});
  assert.deepEqual(p.actions.map(a=>a.op),['workflow.rerun']);
  assert.equal(p.execute,true);
  const again=planRepair(diagnoseRun({run:verifyRun({run_attempt:2}),jobs:jobs([])}),{mode:'act'});
  assert.deepEqual(again.actions.map(a=>a.op),['owner.escalate'],'never a second automatic rerun');
  assert.equal(again.approvalCards.length,1);
});

test('Sentinel: a real failure on main opens one labeled issue, Skeptic reviews, nothing merges',()=>{
  const d=diagnoseRun({run:verifyRun(),jobs:jobs([job('test','failure',[{name:'Syntax and regression checks',conclusion:'failure'}]),
    job('attested-receipt','skipped')])});
  assert.equal(d.category,'real-failure');
  assert.equal(d.signature,'.github/workflows/verify.yml|main|test');
  const p=planRepair(d,{mode:'act',agent:'copilot'});
  assert.deepEqual(p.actions.map(a=>a.op),['issue.upsert','agent.assign','skeptic.review']);
  assert.ok(p.actions[0].labels.includes('self-repair'));
  for(const a of p.actions)assert.ok(!OWNER_ONLY_OPERATIONS.includes(a.op));
});

test('Steward: failures touching workflows or secrets escalate instead of auto-fixing',()=>{
  const run=verifyRun({event:'pull_request',head_branch:'feat/x'});
  const d=diagnoseRun({run,jobs:jobs([job('test','failure'),job('fixed-comparison','success')]),pullRequest:pr()});
  assert.equal(d.scope,'pr#5');
  const p=planRepair(d,{mode:'act',agent:'copilot',changedPaths:['.github/workflows/verify.yml']});
  assert.ok(p.actions.some(a=>a.op==='owner.escalate'));
  assert.ok(!p.actions.some(a=>a.op==='agent.assign'));
  assert.ok(p.actions[0].labels.includes('needs-owner'));
});

test('scope: forks, other authors and comment-triggered runs are out of scope',()=>{
  const foreign=pr({user:{login:'someone',id:1}});
  assert.equal(diagnoseRun({run:verifyRun({event:'pull_request',head_branch:'x'}),jobs:jobs([]),pullRequest:foreign}).category,'out-of-scope');
  assert.equal(diagnoseRun({run:verifyRun({event:'issue_comment',path:'.github/workflows/owner-comment-router.yml'}),jobs:jobs([])}).category,'out-of-scope');
  assert.equal(planRepair(diagnoseRun({run:verifyRun({event:'issue_comment'}),jobs:jobs([])}),{mode:'act'}).actions.length,0);
});

test('report-only and off never execute',()=>{
  const d=diagnoseRun({run:verifyRun(),jobs:jobs([])});
  assert.equal(planRepair(d,{mode:'report-only'}).execute,false);
  assert.equal(planRepair(d,{}).execute,false);
  assert.equal(planRepair(d,{mode:'off'}).actions.length,0);
});

test('every planned op is allow-listed and none is owner-only',()=>{
  for(const op of ALLOWED_OPS)assert.ok(!OWNER_ONLY_OPERATIONS.includes(op),op);
});

test('Builder: only stale, owner-authored, same-repo drafts behind main get update-branch',()=>{
  const now=Date.parse('2026-11-10T12:00:00Z');
  const picked=selectStaleDrafts([pr(),pr({number:6,draft:false}),pr({number:7,user:{login:'x',id:2}}),
    pr({number:8,updated_at:'2026-11-10T11:00:00Z'}),
    pr({number:9,head:{ref:'y',sha:SHA,repo:{full_name:'fork/Ultron.MW'}}})],{now});
  assert.deepEqual(picked.map(p=>p.number),[5]);
  assert.equal(planBranchUpdate(pr(),{mergeable_state:'behind'}).op,'pr.update-branch');
  assert.equal(planBranchUpdate(pr(),{mergeable_state:'dirty'}).op,'owner.escalate');
  assert.equal(planBranchUpdate(pr(),{mergeable_state:'clean'}),null);
});

test('log text is untrusted: secrets redacted, mentions and fences defanged',()=>{
  const s=sanitizeLog('token ghp_'+'a'.repeat(30)+' @michaeljwilliams0123 ```x``` Authorization: Bearer abc');
  assert.doesNotMatch(s,/ghp_a|```|Bearer abc|@michael/);
  const d=diagnoseRun({run:verifyRun(),jobs:jobs([job('test','failure')])});
  const body=renderIssue(d,planRepair(d,{mode:'act'}),{logTail:'boom'});
  assert.ok(body.startsWith(issueMarker(d.signature)));
  assert.equal(findIssueForSignature([{number:3,body}],d.signature).number,3);
  assert.equal(findIssueForSignature([{number:4,body,pull_request:{}}],d.signature),null);
});

function fakeGitHub(routes){
  const writes=[];
  const gh={writes,
    get:async(path)=>{for(const [re,v] of routes)if(re.test(path))return typeof v==='function'?v(path):v;throw Error('GET '+path);},
    post:async(path,body)=>{writes.push(['POST',path,body]);return {number:77};},
    put:async(path,body)=>{writes.push(['PUT',path,body]);return {};},
  };
  return gh;
}

test('adapter: plan-only run makes zero writes; act opens one issue then comments on recurrence',async()=>{
  const routes=[[/\/actions\/runs\/11$/,verifyRun()],[/\/jobs\?/,jobs([job('test','failure')].map(j=>({...j,id:1})))],
    [/\/actions\/jobs\/1\/logs/,'not ok 1'],[/\/issues\?state=open/,[]]];
  const dry=fakeGitHub(routes);
  const r=await handleRun(dry,11,{mode:'act',execute:false});
  assert.equal(r.plan.execute,true);
  assert.equal(dry.writes.length,0);
  const wet=fakeGitHub(routes);
  await handleRun(wet,11,{mode:'act',execute:true});
  assert.deepEqual(wet.writes.map(w=>w[1]),['/issues']);
  const d=diagnoseRun({run:verifyRun(),jobs:jobs([job('test','failure')])});
  const again=fakeGitHub([...routes.slice(0,3),[/\/issues\?state=open/,[{number:9,body:issueMarker(d.signature),labels:[]}]]]);
  await handleRun(again,11,{mode:'act',execute:true});
  assert.deepEqual(again.writes.map(w=>w[1]),['/issues/9/comments']);
  assert.match(renderSummary({mode:'act',runs:[r],drafts:[],executed:false}),/plan only/);
});

test('adapter: sweep updates a behind draft with expected head and dispatches Verify; never force-pushes',async()=>{
  const gh=fakeGitHub([[/\/pulls\?state=open/,[pr()]],[/\/pulls\/5$/,{mergeable_state:'behind'}]]);
  const out=await sweepDrafts(gh,{execute:true,now:Date.parse('2026-11-10T12:00:00Z')});
  assert.equal(out.length,1);
  assert.deepEqual(gh.writes,[['PUT','/pulls/5/update-branch',{expected_head_sha:SHA}],
    ['POST','/actions/workflows/verify.yml/dispatches',{ref:'feat/x'}]]);
});

test('workflow is report-only by default, splits read and write jobs, never runs PR code',()=>{
  const y=readFileSync(new URL('../.github/workflows/council-self-repair.yml',import.meta.url),'utf8');
  assert.match(y,/vars\.ULTRON_SELF_REPAIR_MODE \|\| 'report-only'/);
  assert.match(y,/needs\.diagnose\.outputs\.act == 'true' && vars\.ULTRON_SELF_REPAIR_MODE == 'act'/);
  const [diagnose,act]=y.split('\n  act:\n');
  assert.doesNotMatch(diagnose,/: write/);
  assert.match(act,/issues: write/);
  assert.equal((y.match(/ref: main/g)||[]).length,2);
  assert.doesNotMatch(y,/pull_request_target|head_sha|head\.ref|\$\{\{ inputs\.run_id \}\}\s*$/m);
  assert.doesNotMatch(y,/GEMINI|GROQ|OPENAI/);
});
