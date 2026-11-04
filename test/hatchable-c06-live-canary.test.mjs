import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyC06ModelRun,C06_RUN,C06_SOURCE,C06_ARTIFACT_ID} from '../cloud/hatchable/lib/c06-live-evidence.js';
const read=p=>readFileSync(p,'utf8');
const ok=value=>({ok:true,status:200,json:async()=>value});
const origin={
 id:C06_RUN,run_attempt:1,path:'.github/workflows/c06-owner-model-release.yml',
 event:'workflow_dispatch',status:'completed',conclusion:'success',
 head_sha:C06_SOURCE,head_branch:'main',
 actor:{login:'michaeljwilliams0123'},
 repository:{full_name:'michaeljwilliams0123/Ultron.MW',private:false}
};
const digest='sha256:51a777be41c5b988127f72bb335c6ace45caf6c09d6b7316d5111cc9705ea5aa';
const artifact={id:C06_ARTIFACT_ID,name:'c06-model-output-'+C06_RUN,size_in_bytes:3129,digest,expired:false};
const upstream=async url=>String(url).includes('/artifacts')?ok({artifacts:[artifact]}):ok(origin);
test('C06-LIVE-01: real source-pinned GitHub run and artifact classify through model-origin code',async()=>{
 const result=await verifyC06ModelRun({fetchGithub:upstream});
 assert.equal(result.ok,true);
 assert.equal(result.modelDecision,'verified');
 assert.equal(result.runId,C06_RUN);
 assert.equal(result.sourceSha,C06_SOURCE);
 assert.equal(result.artifactDigest,digest);
 assert.equal(result.productionAccepted,false);
 assert.equal(result.paidCents,0);
});
test('C06-LIVE-02: no success for tampered origin, actor, status, source or artifact',async()=>{
 const failures=[
  {run:{...origin,head_sha:'b'.repeat(40)}},
  {run:{...origin,actor:{login:'other-user'}}},
  {run:{...origin,status:'in_progress',conclusion:null}},
  {run:{...origin,repository:{full_name:'other/repo',private:false}}},
  {run:{...origin,run_attempt:2}},
  {run:origin,artifact:{...artifact,digest:'sha256:'+'0'.repeat(64)}},
  {run:origin,artifact:{...artifact,expired:true}},
  {run:origin,artifact:{...artifact,name:'unexpected.zip'}}
 ];
 for(const row of failures){
  const fetchGithub=async url=>String(url).includes('/artifacts')?
   ok({artifacts:[row.artifact||artifact]}):ok(row.run);
  const result=await verifyC06ModelRun({fetchGithub});
  assert.equal(result.ok,false);
  assert.notEqual(result.modelDecision,'verified');
 }
});
test('C06-LIVE-03: failed GitHub provider read never creates synthetic evidence',async()=>{
 const r=await verifyC06ModelRun({fetchGithub:async()=>({ok:false,status:403})});
 assert.equal(r.ok,false);
 assert.equal(r.reason,'github-readback-unavailable');
});
test('C06-LIVE-04: deployed model and independent owner adapter match audited root files byte-for-byte',()=>{
 assert.equal(read('cloud/hatchable/lib/c06-model-candidate.js'),read('lib/c06-model-candidate.js'));
 assert.equal(read('cloud/hatchable/lib/c06-owner-safe.js'),read('lib/c06-owner-safe.mjs'));
});
test('C06-LIVE-05: posted canary is owner-only and cannot execute external GitHub writes',()=>{
 const route=read('cloud/hatchable/api/brain/c06-live-canary.js');
 const migration=read('cloud/hatchable/migrations/0022_c06_live_receipts.sql');
 assert.match(route,/export const access='admin'/);
 assert.match(route,/methods=\['GET','POST'\]/);
 assert.match(route,/req\.member\?\.handle/);
 assert.match(route,/expectedStopVersion/);
 assert.match(route,/readExecutionControl/);
 assert.match(route,/brain_runtime_control/);
 assert.match(route,/ON CONFLICT\(task_key\) DO NOTHING/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS c06_live_receipts/);
 assert.doesNotMatch(route,/pr\.squash|github\.dispatch|actions\/workflows\/.*dispatches|ai\.generateText/);
});

test('C06-LIVE-06: owner button is explicit, sign-in gated and shares no GitHub token',()=>{
 const html=read('cloud/hatchable/public/index.html');
 const js=read('cloud/hatchable/public/c06-live.js');
 assert.match(html,/id="c06-live-start"/);
 assert.match(html,/id="c06-live-status"/);
 assert.match(html,/src="\.\/c06-live\.js"/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/textContent/);
 assert.match(js,/addEventListener\('click'/);
 assert.doesNotMatch(js,/setInterval|new EventSource|innerHTML\s*=/);
 assert.doesNotMatch(js,/GITHUB_TOKEN|Authorization:|HF_TOKEN|model\.generate/);
});
