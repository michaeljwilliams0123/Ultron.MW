import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {admitC06Replay, C06_REPLAY_PINNED_PATHS} from '../src/c06-replay-admission.mjs';

const original='a'.repeat(40),latest='b'.repeat(40);
const valid={repository:'michaeljwilliams0123/Ultron.MW',actor:'michaeljwilliams0123',
 sourceSha:original,mainSha:latest,runId:'41775971062',
 isOriginalAncestor:true,changedModelToolchainPaths:[],alreadyPublished:false,
 paidBudgetCents:0,publicRepository:true};
test('C06-R01 requires verified original ancestor, identical generator and no duplicate branch',()=>{
 const approved=admitC06Replay(valid);
 assert.equal(approved.originSha,original);
 assert.equal(approved.mainSha,latest);
 assert.equal(approved.runId,'41775971062');
 assert.ok(C06_REPLAY_PINNED_PATHS.includes('src/c06-model-origin.mjs'));
 assert.ok(C06_REPLAY_PINNED_PATHS.includes('.github/workflows/c06-owner-model-release.yml'));
 for(const patch of [{actor:'attacker'},{repository:'another/repo'},
  {sourceSha:'main'},{mainSha:'main'},{runId:'x123'},
  {isOriginalAncestor:false},{alreadyPublished:true},
  {paidBudgetCents:1},{paidBudgetCents:-1},{publicRepository:false},
  {changedModelToolchainPaths:['src/c06-model-origin.mjs']}]){
  assert.throws(()=>admitC06Replay({...valid,...patch}),/c06-replay-admission-denied/);
 }
});
test('C06-R02 strict source revision or changed untrusted toolchain cannot be waived',()=>{
 assert.throws(()=>admitC06Replay({...valid,sourceSha:latest,mainSha:latest,
  changedModelToolchainPaths:['src/c06-model-origin.mjs']}),/c06-replay-admission-denied/);
 for(const bad of [null,'README.md','src/c06-model-origin.mjs\nother']){
  assert.throws(()=>admitC06Replay({...valid,changedModelToolchainPaths:bad}),/c06-replay-admission-denied/);
 }
});
test('C06-R03 replay workflow must be owner-only and copy generated files, never run them with write token',async()=>{
 const wf=await readFile(new URL('../.github/workflows/c06-reconcile-publish.yml',import.meta.url),'utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.match(wf,/needs: verify/);
 assert.match(wf,/actions\/download-artifact@/);
 assert.match(wf,/run-id:/);
 assert.match(wf,/node scripts\/c06-verify-replay\.mjs/);
 assert.match(wf,/pull-requests: write/);
 assert.match(wf,/contents: read/);
 assert.match(wf,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(wf,/git diff --cached --check/);
 assert.match(wf,/git merge-base --is-ancestor/);
 assert.doesNotMatch(wf,/HF_TOKEN|OPENAI_API_KEY|gpu-|github_pat_|force-push/);
});
test('C06-R04 replay source verifier performs immutable hash/lineage check only',async()=>{
 const script=await readFile(new URL('../scripts/c06-verify-replay.mjs',import.meta.url),'utf8');
 assert.match(script,/verifyC06Files/);
 assert.match(script,/admitC06Replay/);
 assert.doesNotMatch(script,/import\s*\(.*c06-model-candidate|vm\.run|execSync\(/);
});
