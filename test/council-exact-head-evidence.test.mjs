import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCouncilExactHeadEvidence} from '../src/council-exact-head-evidence.mjs';

const SHA='a'.repeat(40),BASE='b'.repeat(40),APP=15368;
const REPO={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const pr=()=>({number:397,state:'open',head:{sha:SHA,repo:{...REPO}},
 base:{ref:'main',sha:BASE,repo:{...REPO}}});
const compare=()=>({status:'ahead',behind_by:0,merge_base_commit:{sha:BASE}});
const checks=()=>({check_runs:['test','fixed-comparison','attested-receipt'].map(name=>({
 name,head_sha:SHA,status:'completed',conclusion:'success',app:{id:APP,slug:'github-actions'}
}))});
function run(p=pr(),c=compare(),v=checks()){
 return buildCouncilExactHeadEvidence({pr:p,comparison:c,checkRuns:v});
}
test('valid GitHub Actions exact-head checks produce advisory evidence, not release authority',()=>{
 const evidence=run();
 assert.equal(evidence.verified,true);
 assert.equal(evidence.sourceSha,SHA);
 assert.equal(evidence.prNumber,397);
 assert.equal(evidence.providerAppId,APP);
 assert.deepEqual(evidence.checks,['test','fixed-comparison','attested-receipt']);
 assert.equal(evidence.releaseAuthorized,false);
});
test('missing, failed, pending, stale or non-Actions check is never verified',()=>{
 for(const mutate of [
  c=>{c.check_runs.pop();},
  c=>{c.check_runs[0].conclusion='failure';},
  c=>{c.check_runs[1].status='in_progress';},
  c=>{c.check_runs[2].head_sha='c'.repeat(40);},
  c=>{c.check_runs[0].app.id=123;},
  c=>{c.check_runs[1].app.slug='untrusted-app';}
 ]){const x=checks();mutate(x);assert.equal(run(pr(),compare(),x).verified,false);}
});
test('head/base drift, fork, closed PR, or branch behind main cannot produce evidence',()=>{
 for(const mutate of [
  (p,c)=>{p.state='closed';},
  (p,c)=>{p.head.sha='invalid';},
  (p,c)=>{p.head.repo.id=12;},
  (p,c)=>{p.base.repo.full_name='foreign/repo';},
  (p,c)=>{p.base.ref='staging';},
  (p,c)=>{c.behind_by=1;},
  (p,c)=>{c.merge_base_commit.sha='c'.repeat(40);},
  (p,c)=>{c.status='diverged';}
 ]){const p=pr(),c=compare();mutate(p,c);assert.equal(run(p,c).verified,false);}
});
test('duplicate check-name impersonation is rejected',()=>{
 const v=checks();v.check_runs.push({...v.check_runs[0],app:{id:999,slug:'bogus'}});
 assert.equal(run(pr(),compare(),v).verified,false);
});
test('a missing or fabricated check array does not pass',()=>{
 assert.equal(run(pr(),compare(),{}).verified,false);
 assert.equal(run(pr(),compare(),null).verified,false);
});
