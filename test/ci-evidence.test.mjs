import test from 'node:test';
import assert from 'node:assert/strict';
import {selectVerifiedMainCi,readVerifiedMainCi} from '../src/ci-evidence.mjs';
import {evaluateSelfSnapshot} from '../src/self-observer.mjs';

const REPO='michaeljwilliams0123/Ultron.MW',SHA='a'.repeat(40);
const run={id:100,name:'Ultron core verification',path:'.github/workflows/verify.yml',
  head_sha:SHA,head_branch:'main',head_repository:{full_name:REPO},
  event:'push',status:'completed',conclusion:'success',run_attempt:1};
test('exact main success is sourced from real GitHub Verify metadata, not a generated assertion',async()=>{
  const payload={total_count:1,workflow_runs:[run]};
  const x=selectVerifiedMainCi(payload,SHA);
  assert.equal(x.conclusion,'success');
  assert.equal(x.sha,SHA);
  assert.equal(x.runUrl,'https://github.com/'+REPO+'/actions/runs/100');
  let path='';
  const observed=await readVerifiedMainCi({mainSha:SHA,get:async p=>{path=p;return payload;}});
  assert.equal(observed.runId,100);
  assert.equal(path,'/repos/'+REPO+'/actions/workflows/verify.yml/runs?head_sha='+SHA+'&branch=main&per_page=100');
});
test('stale SHA, blocked runs, bad provenance and incomplete pages never prove success',()=>{
  for(const wrong of [
    {...run,head_sha:'b'.repeat(40)},
    {...run,head_repository:{full_name:'other/repo'}},
    {...run,path:'.github/workflows/pr-brain.yml'},
    {...run,status:'in_progress'},
    {...run,event:'issue_comment'},
  ])assert.equal(selectVerifiedMainCi({total_count:1,workflow_runs:[wrong]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:101,workflow_runs:[run]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:2,workflow_runs:[run]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:100,
    workflow_runs:Array.from({length:100},(_,i)=>({...run,id:i+1}))},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:0,workflow_runs:[]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,conclusion:'action_required'}]},SHA).conclusion,'action_required');
  assert.equal(selectVerifiedMainCi({total_count:2,workflow_runs:[run,
    {...run,id:101,status:'in_progress',conclusion:null}]},SHA),null);
});
test('only attested exact-main CI removes missing-evidence weakness',()=>{
  const paths=['.github/workflows/verify.yml','test/x.test.mjs'];
  const texts={'.github/workflows/verify.yml':'node scripts/verify.mjs'};
  const base={environment:'cloud',observedAt:'2026-10-19T00:00:00Z',paths,
    sourceTexts:texts,commitSha:SHA,treeSha:'b'.repeat(40)};
  // The scanner's full route contract is mandatory; observe CI assessment from
  // the real source fixture through source mock in self-observer.test.mjs.
  assert.throws(()=>evaluateSelfSnapshot(base),/source contents unavailable/);
});
test('run-name display titles do not hide main CI; identity is the workflow path',async()=>{
  // verify.yml `run-name:` makes GitHub return the commit message or PR title as `name`.
  for(const name of ['fix(ci): classify missing Verify jobs (#401)','Ultron repair abc','Ultron core verification']){
    const x=selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,name,display_title:name}]},SHA);
    assert.equal(x?.runId,100,name);
    assert.equal(x.conclusion,'success');
  }
  const dispatched=selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,event:'workflow_dispatch',name:'Ultron repair r1'}]},SHA);
  assert.equal(dispatched.event,'workflow_dispatch');
  // A different workflow cannot borrow the old Verify name to impersonate it.
  assert.equal(selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,
    path:'.github/workflows/council-debate.yml',name:'Ultron core verification'}]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,path:undefined}]},SHA),null);
  // Newest completed Verify run on the exact SHA wins.
  const newest=selectVerifiedMainCi({total_count:2,workflow_runs:[
    {...run,name:'a'},{...run,id:101,name:'b',conclusion:'failure'}]},SHA);
  assert.equal(newest.runId,101);
  assert.equal(newest.conclusion,'failure');
});
test('reader asks GitHub only for verify.yml runs on main and treats errors as unknown',async()=>{
  const realShape={total_count:1,workflow_runs:[{...run,id:42946445938,
    name:'feat(c04): add owner-signed Coordinator comment canary (#399)'}]};
  const seen=[];
  const x=await readVerifiedMainCi({mainSha:SHA,get:async p=>{seen.push(p);return realShape;}});
  assert.equal(x.runId,42946445938);
  assert.equal(seen.length,1);
  assert.match(seen[0],/\/actions\/workflows\/verify\.yml\/runs\?head_sha=a{40}&branch=main&per_page=100$/);
  assert.equal(await readVerifiedMainCi({mainSha:SHA,get:async()=>{throw Error('503');}}),null);
  assert.equal(await readVerifiedMainCi({mainSha:'main',get:async()=>realShape}),null);
});
