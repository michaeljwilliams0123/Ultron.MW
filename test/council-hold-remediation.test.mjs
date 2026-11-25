import test from 'node:test';
import assert from 'node:assert/strict';
import {planCouncilRemediation, selectCouncilRetry, councilRemediationIssue} from '../src/council-hold-remediation.mjs';
const sha='a'.repeat(40),base='b'.repeat(40),now=Date.parse('2026-11-25T03:30:00Z');
const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const pr={number:550,state:'open',head:{sha,repo},base:{sha:base,ref:'main',repo}};
const result={status:'held',reason:'council-not-unanimous',sourceSha:sha,baseSha:base,prNumber:550,securitySensitive:false,approvedCount:7,holdRoles:[],modelHoldRoles:['Builder']};
const models={Builder:{source:'deterministic-fallback',modelInvoked:false,fallbackReason:'free-tier-exhausted-or-failed',attempts:[{outcome:'http-429'}]}};
const receipt={modelReview:{results:models}};
const gate={id:10,app:{id:5765239},name:'ultron/council-7of7',head_sha:sha,status:'completed',conclusion:'failure',completed_at:'2026-11-25T03:00:00Z'};
const run={id:20,workflow_id:416079861,status:'completed',run_attempt:1,repository:repo,html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/20'};
test('provider outage is retriable, not an invented finding or a pass',()=>{
 const p=planCouncilRemediation({result,receipt});
 assert.equal(p.route,'retry-model');assert.equal(p.authorization,'held');assert.equal(p.ownerRequired,false);
});
test('explicit model dissent must be investigated, never retried until it votes yes',()=>{
 const p=planCouncilRemediation({result,receipt:{modelReview:{results:{Builder:{source:'model',modelInvoked:true,verdict:'revise',disagreements:[]}}}}});
 assert.equal(p.route,'investigate');assert.equal(p.authorization,'held');
});
test('no credentials, rejected input and unknown evidence do not become retryable',()=>{
 for(const fallbackReason of ['no-credentials','input-blocked:private-source','unknown']){
  const p=planCouncilRemediation({result,receipt:{modelReview:{results:{Builder:{...models.Builder,fallbackReason}}}}});
  assert.notEqual(p.route,'retry-model');
 }
 assert.equal(planCouncilRemediation({result:{...result,reason:'missing-or-stale-council-evidence'},receipt}).route,'collect-evidence');
});
test('security classification remains owner-only even if providers are down or unanimous',()=>{
 const p=planCouncilRemediation({result:{...result,securitySensitive:true},receipt});
 assert.equal(p.ownerRequired,true);assert.equal(p.authorization,'held');assert.equal(p.route,'owner-review');
});
test('only fresh exact-head trusted gate run may retry once',()=>{
 const plan=planCouncilRemediation({result,receipt});
 const check={...gate,output:{text:JSON.stringify(plan)},details_url:run.html_url};
 assert.equal(selectCouncilRetry({pr,check,run,now}).runId,20);
 for(const overrides of [{run:{...run,run_attempt:2}},{run:{...run,workflow_id:9}},{check:{...check,app:{id:1}}},{pr:{...pr,head:{...pr.head,sha:'c'.repeat(40)}}},{pr:{...pr,base:{...pr.base,sha:'c'.repeat(40)}}},{now:Date.parse('2026-11-25T03:01:00Z')},{check:{...check,conclusion:'success'}}]){
  assert.equal(selectCouncilRetry({pr,check,run,now,...overrides}),null);
 }
 assert.equal(selectCouncilRetry({pr,check,run,now,priorRetry:true}),null);
});
test('investigation issue is exact head deduplicated and never a code execution request',()=>{
 const p=planCouncilRemediation({result:{...result,securitySensitive:true},receipt});
 const issue=councilRemediationIssue(p);
 assert.match(issue.marker,/550/);assert.match(issue.body,/owner/i);assert.doesNotMatch(issue.body,/\/codex run|\/council override/);
 assert.equal(councilRemediationIssue({...p,authorization:'accepted'}),null);
});

import {sweepCouncilHolds} from '../scripts/council-hold-remediation.mjs';
function fake({plan=planCouncilRemediation({result,receipt}),mode='act',existing=false,stale=false,attempt=1,prior=false}={}){
 const check={...gate,details_url:run.html_url,output:{text:JSON.stringify(plan)}};
 const calls=[];let freshReads=0;
 const inventory={total_count:prior?2:1,check_runs:prior?[check,{...check,id:9,details_url:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/19'}]:[check]};
 const gh={
  async get(path){
   if(path.startsWith('/pulls?'))return [pr];
   if(path==='/pulls/550'){freshReads++;return stale?{...pr,head:{...pr.head,sha:'c'.repeat(40)}}:pr;}
   if(path.startsWith('/commits/'))return inventory;
   if(path==='/actions/runs/20')return {...run,run_attempt:attempt};
   if(path==='/actions/runs/19')return {...run,id:19,run_attempt:2};
   if(path.startsWith('/issues?'))return existing?[{number:801,user:{id:41898282},body:councilRemediationIssue(plan).marker}]:[];
   throw Error('unexpected GET '+path);
  },
  async post(path,body){calls.push({path,body});return {number:802};}
 };
 return {gh,calls,mode};
}
test('hourly recovery invokes a single exact-head trusted recheck, not a release',async()=>{
 const f=fake();
 const r=await sweepCouncilHolds({gh:f.gh,mode:f.mode,now});
 assert.equal(r[0].status,'recheck-dispatched');
 assert.deepEqual(f.calls,[{path:'/actions/runs/20/rerun',body:{}}]);
});
test('report-only, off and moved heads cannot mutate GitHub',async()=>{
 for(const opts of [{mode:'report-only'},{mode:'off'},{stale:true}]){
  const f=fake(opts);await sweepCouncilHolds({gh:f.gh,mode:f.mode,now});assert.deepEqual(f.calls,[]);
 }
});
test('a spent retry budget produces one investigation record; repeat scans do not duplicate it',async()=>{
 for(const opts of [{attempt:2},{prior:true}]){
  const f=fake(opts);const r=await sweepCouncilHolds({gh:f.gh,mode:f.mode,now});
  assert.equal(r[0].status,'investigation-opened');assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/issues');
 }
 const f=fake({attempt:2,existing:true});
 const r=await sweepCouncilHolds({gh:f.gh,mode:f.mode,now});
 assert.equal(r[0].status,'investigation-already-recorded');assert.deepEqual(f.calls,[]);
});
test('owner-only hold creates an investigation, never reruns to obtain a different vote',async()=>{
 const plan=planCouncilRemediation({result:{...result,securitySensitive:true},receipt});
 const f=fake({plan});const r=await sweepCouncilHolds({gh:f.gh,mode:f.mode,now});
 assert.equal(r[0].ownerRequired,true);assert.equal(f.calls[0].path,'/issues');
 assert.match(f.calls[0].body.body,/no automatic governance edits/);
});
