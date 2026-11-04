/** Manual six-job, no-secret, read-only, CPU-only held-out code-repair run.
 * Candidate model receives broken public function and a requirement, never
 * the reference solution or reference behavior vectors.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {selectFreeModelProfile,resolveEvaluationRevision}
 from '../src/hf-free-compute.mjs';
import {admitHeldoutCpu,heldoutShard,scoreProposedRepair,makeHeldoutReceipt}
 from '../src/hf-heldout-eval.mjs';

const plan=admitHeldoutCpu({
 repository:process.env.GITHUB_REPOSITORY,
 isPublic:process.env.ULTRON_REPOSITORY_PUBLIC==='true',
 runner:process.env.ULTRON_RUNNER_LABEL,
 parallel:4,gpu:false,costCents:0,shards:2
});
const profile=process.env.ULTRON_HF_PROFILE;
const shard=Number(process.env.ULTRON_HF_SHARD);
if(!Number.isSafeInteger(shard)||!Object.hasOwn({
 baseline:1,'coder-small':1,'coder-medium':1},profile)||![0,1].includes(shard))
 throw Error('invalid-heldout-benchmark-input');
const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:profile},{evaluation:true});
const revision=await resolveEvaluationRevision(model);
const {env,pipeline}=await import('@huggingface/transformers');
env.allowRemoteModels=true;
env.allowLocalModels=false;
const start=performance.now();
const generator=await pipeline('text-generation',model.id,{
 device:plan.device,dtype:model.dtype,revision});
const cases=[];
for(const testCase of heldoutShard(shard)){
 const prompt=[{role:'system',content:
  'Repair the JavaScript function exactly. Respond with ONLY the complete JavaScript function named fix(input), no markdown, no explanation, no extra code. Keep all behavior correct.'},
 {role:'user',content:
  'Fix this broken function based on this specification: '+testCase.goal+
  '\nBROKEN FUNCTION:\n'+testCase.broken+
  '\nOutput the entire corrected function named fix(input).'}];
 let response='';
 try{
  const result=await generator(prompt,{max_new_tokens:plan.maxNewTokens,
   do_sample:false,return_full_text:false});
  const generated=result?.[0]?.generated_text;
  response=(Array.isArray(generated)?generated.at(-1)?.content:generated)||'';
 }catch{/* Individual model inference failures count as failed cases. */}
 const scored=scoreProposedRepair(testCase,response);
 cases.push(scored);
 console.log(JSON.stringify({case:scored.id,passed:scored.passed,
  correctVectors:scored.correctVectors,totalVectors:scored.vectorCount,
  reason:scored.reason}));
}
const receipt=makeHeldoutReceipt({profile,revision,shard,
 sourceSha:process.env.GITHUB_SHA,durationMs:Math.round(performance.now()-start),
 paidCents:0,cases});
await mkdir('artifacts/hf-heldout',{recursive:true});
const path='artifacts/hf-heldout/'+profile+'-shard'+shard+'.json';
await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({schema:receipt.schema,profile:receipt.profile,
 revision:receipt.revision,sourceSha:receipt.sourceSha,
 corpusDigest:receipt.corpusDigest,passed:receipt.passed,
 total:receipt.caseCount,durationMs:receipt.durationMs,
 paidCents:receipt.paidCents,digest:receipt.digest}));
