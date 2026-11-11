import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {admitC06Replay, C06_REPLAY_PINNED_PATHS, hasNovelC06Outputs} from '../src/c06-replay-admission.mjs';

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
test('C06-R03 replay publish workflow is retired (owner-approved, never ran) and nothing runs the replay with a write token',async()=>{
 const {readdir}=await import('node:fs/promises');
 const dir=new URL('../.github/workflows/',import.meta.url);
 const files=await readdir(dir);
 assert.equal(files.includes('c06-reconcile-publish.yml'),false);
 for(const name of files){
  const wf=await readFile(new URL(name,dir),'utf8');
  assert.doesNotMatch(wf,/c06-verify-replay\.mjs/,name);
 }
});
test('C06-R04 replay source verifier performs immutable hash/lineage check only',async()=>{
 const script=await readFile(new URL('../scripts/c06-verify-replay.mjs',import.meta.url),'utf8');
 assert.match(script,/verifyC06Files/);
 assert.match(script,/admitC06Replay/);
 assert.doesNotMatch(script,/import\s*\(.*c06-model-candidate|vm\.run|execSync\(/);
});

test('C06-R05 replay pins all transitive model validation and dependency inputs',()=>{
 for(const path of ['src/hf-repair-output.mjs','package.json','package-lock.json',
  'scripts/verify-audited-lockfile.mjs']){
  assert.ok(C06_REPLAY_PINNED_PATHS.includes(path),'missing replay dependency '+path);
 }
});

test('C06-R06 existing model files can be replaced only by genuinely changed verified output',()=>{
 const oldFiles={'lib/c06-model-candidate.js':'source-v1',
  'test/c06-model-generated.test.mjs':'vectors-v1',
  'docs/c06-model-generated.md':'invalid-original'};
 const original={...oldFiles};
 const repaired={...original,'docs/c06-model-generated.md':'truthful-model-authored-docs'};
 assert.equal(hasNovelC06Outputs(oldFiles,repaired),true);
 assert.equal(hasNovelC06Outputs(oldFiles,original),false);
 assert.equal(hasNovelC06Outputs({},original),true);
 assert.throws(()=>hasNovelC06Outputs(oldFiles,{'docs/c06-model-generated.md':'only-one-file'}),
  /c06-replay-admission-denied/);
});

test('C06-R07 replay must compare full generated file bytes, not reject all preexisting paths',async()=>{
 const s=await readFile(new URL('../scripts/c06-verify-replay.mjs',import.meta.url),'utf8');
 assert.match(s,/hasNovelC06Outputs/);
 assert.doesNotMatch(s,/!!alreadyInMain/);
});
