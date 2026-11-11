import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchCouncilReviewRun,selectLatestCouncilReviewRun}
  from '../src/council-run-provenance.mjs';

const SHA='58a3e20548a522825a3e17bf4862d5ae622440e6';
const REPO={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const BRANCH='governance/council-7of7-20261110';
const pr=()=>({number:397,state:'open',
 head:{sha:SHA,ref:BRANCH,repo:{...REPO}},
 base:{sha:'b'.repeat(40),ref:'main',repo:{...REPO}}});
const run=()=>({
 id:42946913773,event:'pull_request',status:'completed',conclusion:'success',
 workflow_id:401204437,path:'.github/workflows/council-debate.yml',
 head_sha:SHA,head_branch:BRANCH,head_repository:{...REPO},
 repository:{...REPO},
 pull_requests:[] // Actual GitHub REST response for this successful PR run.
});

test('actual successful PR workflow run with empty pull_requests links by exact trusted provenance',()=>{
 const result=matchCouncilReviewRun(run(),pr());
 assert.equal(result,true);
 assert.equal(selectLatestCouncilReviewRun([run()],pr())?.id,42946913773);
});
test('foreign issue, branch, commit, workflow or repository cannot impersonate PR evidence',()=>{
 const changes=[
  r=>{r.event='workflow_dispatch';},
  r=>{r.status='in_progress';},
  r=>{r.conclusion='failure';},
  r=>{r.head_sha='a'.repeat(40);},
  r=>{r.head_branch='another-branch';},
  r=>{r.workflow_id=404;},
  r=>{r.path='.github/workflows/fake-council.yml';},
  r=>{r.head_repository.id=55;},
  r=>{r.head_repository.full_name='other/repo';},
  r=>{r.repository.id=25;},
  r=>{r.pull_requests=[{number:398}];}
 ];
 for(const change of changes){
  const candidate=run();change(candidate);
  assert.equal(matchCouncilReviewRun(candidate,pr()),false);
 }
});
test('the current PR must itself be canonical, open, main-targeted, exact-branch and exact-SHA',()=>{
 for(const change of [
  p=>{p.state='closed';},
  p=>{p.number=0;},
  p=>{p.head.sha='bad';},
  p=>{p.head.ref='different';},
  p=>{p.head.repo.id=9;},
  p=>{p.base.repo.full_name='elsewhere/repo';},
  p=>{p.base.ref='development';}
 ]){
  const candidate=pr();change(candidate);
  assert.equal(matchCouncilReviewRun(run(),candidate),false);
 }
});
test('nonempty GitHub association must agree with PR while empty association is supported',()=>{
 const correct=run();correct.pull_requests=[{number:397}];
 assert.equal(matchCouncilReviewRun(correct,pr()),true);
 const wrong=run();wrong.pull_requests=[{number:398}];
 assert.equal(matchCouncilReviewRun(wrong,pr()),false);
});
test('select newest valid run, ignoring invalid or spoofed later ones',()=>{
 const older=run();older.id=100;
 const newer=run();newer.id=103;
 const invalid=run();invalid.id=104;invalid.path='fake.yml';
 assert.equal(selectLatestCouncilReviewRun([older,invalid,newer],pr())?.id,103);
});
test('trusted workflow actually consumes the tested run binding, not pull_requests-only admission',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
 assert.match(workflow,/selectLatestCouncilReviewRun/);
 assert.doesNotMatch(workflow,/run\.pull_requests\?\.some/);
});
