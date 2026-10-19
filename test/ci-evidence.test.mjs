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
  assert.match(path,/actions\/runs\?head_sha=a{40}&per_page=100/);
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
  assert.equal(selectVerifiedMainCi({total_count:0,workflow_runs:[]},SHA),null);
  assert.equal(selectVerifiedMainCi({total_count:1,workflow_runs:[{...run,conclusion:'action_required'}]},SHA).conclusion,'action_required');
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
