import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectFreeModelProfile,admitFreeCpuTournament,
  resolveEvaluationRevision,makeCpuEvidence,FREE_CPU_MODELS} from '../src/hf-free-compute.mjs';
import {legacyView} from './workflow-lane-view.mjs';

const sha='a'.repeat(40);
const baseline='516c8d04add8a80c5228f32102b57953b8d421a9';
const safe=()=>({repository:'michaeljwilliams0123/Ultron.MW',
 publicRepository:true,paidBudgetCents:0,runner:'ubuntu-24.04',
 gpu:'none',maxParallel:4,shards:2});

test('HF-CPU-01: production stays on the previously verified pinned CPU baseline',()=>{
 const model=selectFreeModelProfile({});
 assert.equal(model.key,'baseline');
 assert.equal(model.id,'onnx-community/Qwen2.5-0.5B-Instruct');
 assert.equal(model.revision,baseline);
 assert.equal(model.device,'cpu');
 assert.equal(model.dtype,'q4');
 assert.equal(model.priceCents,0);
});

test('HF-CPU-02: four profiles share one registry, but only baseline is production-approved',()=>{
 assert.deepEqual(Object.keys(FREE_CPU_MODELS),['baseline','coder-small','coder-medium','coder-large']);
 for(const key of ['coder-small','coder-medium']){
  assert.throws(()=>selectFreeModelProfile({ULTRON_MODEL_PROFILE:key}),/not-promoted/);
  const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:key},{evaluation:true});
  assert.equal(model.device,'cpu');
  assert.equal(model.dtype,'q4');
  assert.equal(model.revision,null,'evaluation must independently resolve an immutable Hub revision');
 }
 assert.throws(()=>selectFreeModelProfile({ULTRON_MODEL_PROFILE:'remote-gpu'}),/unapproved/);
});

test('HF-CPU-03: four standard public runners are admitted without paid compute or GPUs',()=>{
 const plan=admitFreeCpuTournament(safe());
 assert.equal(plan.maxParallel,4);
 assert.equal(plan.parallelVcpus,16);
 assert.equal(plan.parallelRamGiB,64);
 assert.equal(plan.paidBudgetCents,0);
 assert.deepEqual(plan.models,['baseline','coder-small','coder-medium','coder-large']);
 assert.equal(plan.shards,2);
 assert.equal(plan.maxNewTokens,128);
 assert.equal(plan.runner,'ubuntu-24.04');
 assert.equal(plan.gpu,'none');
});

test('HF-CPU-04: refuse private repo, paid executor, GPU, unbounded concurrency and wrong runner',()=>{
 const overrides=[
 {publicRepository:false},{paidBudgetCents:1},{gpu:'zerogpu'},
 {gpu:'t4'},{runner:'ubuntu-24.04-gpu'},{runner:'self-hosted'},
 {maxParallel:5},{maxParallel:0},{shards:10},
 {repository:'outside/Ultron.MW'}
 ];
 for(const change of overrides)
  assert.throws(()=>admitFreeCpuTournament({...safe(),...change}),
    /free-cpu-admission-denied/,JSON.stringify(change));
});

test('HF-CPU-05: Hub SHA resolver never accepts mutable or malformed metadata',async()=>{
 const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:'coder-small'},{evaluation:true});
 const revision=await resolveEvaluationRevision(model,{fetchImpl:async url=>{
  assert.equal(url,'https://huggingface.co/api/models/'+model.id);
  return {ok:true,json:async()=>({sha})};
 }});
 assert.equal(revision,sha);
 for(const result of [{sha:'main'},{sha:'c'.repeat(39)},{},null]){
  await assert.rejects(()=>resolveEvaluationRevision(model,{
   fetchImpl:async()=>({ok:true,json:async()=>result})}),/model-revision-unavailable/);
 }
 await assert.rejects(()=>resolveEvaluationRevision(model,{
  fetchImpl:async()=>({ok:false,status:429})}),/model-revision-unavailable/);
});

test('HF-CPU-06: a benchmark receipt is source-pinned, bounded and rejects any billed effect',()=>{
 const input={profile:'coder-small',revision:sha,shard:0,
  sourceSha:'b'.repeat(40),durationMs:2000,paidCents:0,
  cases:[{id:'case-01',passed:true},{id:'case-02',passed:false}]};
 const receipt=makeCpuEvidence(input);
 assert.equal(receipt.schema,'ultron.hf.free-cpu-eval.v1');
 assert.equal(receipt.caseCount,2);
 assert.equal(receipt.passed,1);
 assert.match(receipt.digest,/^[a-f0-9]{64}$/);
 assert.equal(receipt.paidCents,0);
 assert.equal(makeCpuEvidence(input).digest,receipt.digest);
 assert.throws(()=>makeCpuEvidence({...input,paidCents:1}),/invalid-free-cpu-evidence/);
 assert.throws(()=>makeCpuEvidence({...input,revision:'main'}),/invalid-free-cpu-evidence/);
 assert.throws(()=>makeCpuEvidence({...input,cases:[]}),/invalid-free-cpu-evidence/);
});

test('HF-CPU-07: workflow performs bounded parallel evaluation without scheduled or GPU paid jobs',async()=>{
 const workflow=legacyView('hf-free-cpu-tournament.yml');
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/^\s+schedule:/m);
 assert.match(workflow,/max-parallel:\s*4/);
 assert.match(workflow,/runs-on:\s*ubuntu-24\.04/);
 assert.match(workflow,/github\.event\.repository\.private == false/);
 assert.match(workflow,/contents:\s*read/);
 assert.match(workflow,/hf-free-cpu-benchmark\.mjs/);
 assert.doesNotMatch(workflow,/secrets\.|HF_TOKEN|CUDA_VISIBLE_DEVICES|gpu-[^\s]+/i);
});


test('HF-CPU-08: larger 3B code model is pinned and evaluation-only on free CPU',()=>{
 const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:'coder-large'},{evaluation:true});
 assert.equal(model.id,'onnx-community/Qwen2.5-Coder-3B-Instruct');
 assert.equal(model.revision,'0e076a9c5291f8c74b3ce1558f21336b18f94739');
 assert.equal(model.device,'cpu');
 assert.equal(model.dtype,'q4');
 assert.equal(model.priceCents,0);
 assert.throws(()=>selectFreeModelProfile({ULTRON_MODEL_PROFILE:'coder-large'}),/not-promoted/);
});

test('HF-CPU-09: the 3B model is research-only, not eligible for commercial production',()=>{
 const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:'coder-large'},{evaluation:true});
 assert.equal(model.license,'qwen-research');
 assert.equal(model.approvedUse,'noncommercial-evaluation-only');
 assert.throws(()=>selectFreeModelProfile({ULTRON_MODEL_PROFILE:'coder-large'}),/not-promoted/);
});
