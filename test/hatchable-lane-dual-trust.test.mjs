import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LAB_LANE_FILE,LAB_LANE_PATH,LAB_LANE_NAME,GOVERNED_LANE_FILE,
 LAB_TASK_BY_KEY,labRunTitle,labLaneRunKey} from '../cloud/hatchable/lib/workflow-lanes.js';

const read=path=>readFileSync(path,'utf8');

test('LANE-01: lab lane identity is one exact path, name and allowlisted title',()=>{
 assert.equal(LAB_LANE_PATH,'.github/workflows/'+LAB_LANE_FILE);
 assert.equal(GOVERNED_LANE_FILE,'lane-governed-task.yml');
 assert.deepEqual(LAB_TASK_BY_KEY,{heldout:'hf-heldout-cpu',
  tournament:'hf-free-cpu-tournament',c06:'c06-owner-model-release'});
 for(const [key,task] of Object.entries(LAB_TASK_BY_KEY))
  assert.equal(labLaneRunKey({path:LAB_LANE_PATH,name:LAB_LANE_NAME,display_title:labRunTitle(task)}),key);
 assert.throws(()=>labRunTitle('held-out-acceptance'),/unknown-lab-task/);
 for(const bad of [
  {path:LAB_LANE_PATH,name:LAB_LANE_NAME,display_title:'Ultron lab evidence: __proto__'},
  {path:LAB_LANE_PATH,name:LAB_LANE_NAME,display_title:'Ultron lab evidence: constructor'},
  {path:LAB_LANE_PATH+'@refs/heads/main',name:LAB_LANE_NAME,display_title:labRunTitle('hf-heldout-cpu')},
  {path:LAB_LANE_PATH,name:LAB_LANE_NAME+' ',display_title:labRunTitle('hf-heldout-cpu')},
  {path:LAB_LANE_PATH,name:LAB_LANE_NAME},null,undefined])
  assert.equal(labLaneRunKey(bad),null);
});

test('LANE-02: every legacy Hatchable trust pin is still present during the transition',()=>{
 const oidc=read('cloud/hatchable/lib/council-oidc.js');
 for(const file of ['council-debate.yml','council-worker.yml','owner-comment-router.yml',
  'cloud-pr.yml','lane-governed-task.yml'])assert.ok(oidc.includes('/.github/workflows/'+file+'@refs/heads/main'),file);
 const receipts=read('cloud/hatchable/lib/hf-github-receipts.js');
 for(const file of ['hf-heldout-cpu.yml','hf-free-cpu-tournament.yml','c06-owner-model-release.yml'])
  assert.ok(receipts.includes("'"+file+"'"),file);
 assert.match(read('cloud/hatchable/lib/heldout-evidence.js'),/held-out-acceptance\.yml/);
 assert.match(read('cloud/hatchable/lib/github-oidc-bridge.js'),/hf-oidc-bridge\.yml/);
 assert.match(read('cloud/hatchable/lib/mahoraga-actions.js'),/\/actions\/workflows\/verify\.yml/);
});

test('LANE-03: live-only local workbook page is in source without platform-injected markup',()=>{
 const html=read('cloud/hatchable/public/local-workbooks.html');
 assert.doesNotMatch(html,/__hatchable|__HATCHABLE__|hb-badge/);
 assert.doesNotMatch(html,/github\.com\/Ultron-MW\//);
 assert.match(html,/href="https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW"/);
 assert.match(html,/<script defer src="\/vendor\/fflate-0\.8\.2\.min\.js"><\/script>/);
 assert.match(html,/<script defer src="\/local-workbooks\.js"><\/script>/);
 // Byte-identical to the published fflate@0.8.2 umd/index.js (npm tarball).
 const vendor=readFileSync('cloud/hatchable/public/vendor/fflate-0.8.2.min.js');
 assert.equal(createHash('sha256').update(vendor).digest('hex'),
  'c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf');
});
