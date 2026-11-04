/** Read-only, resource-bounded Hugging Face CPU model evaluation.
 * Produces scored JSON receipts; never writes to GitHub, main or Hatchable.
 * Each public standard runner processes only two fixed cases and exits.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {admitFreeCpuTournament,selectFreeModelProfile,
  resolveEvaluationRevision,makeCpuEvidence} from '../src/hf-free-compute.mjs';

const CASES=Object.freeze([
 {id:'durable-stage',original:"const state = 'pending';",
  instruction:'Replace the literal pending with observed.',
  expected:"const state = 'observed';"},
 {id:'retry-guard',original:'const allowRetry = true;',
  instruction:'Replace true with false.',
  expected:'const allowRetry = false;'},
 {id:'owner-fence',original:"const authority = 'optional';",
  instruction:'Replace optional with required.',
  expected:"const authority = 'required';"},
 {id:'receipt-repair',original:'const receiptCount = 0;',
  instruction:'Replace 0 with 1.',
  expected:'const receiptCount = 1;'},
]);

function generatedText(output){
 const value=output?.[0]?.generated_text;
 return (Array.isArray(value)?value.at(-1)?.content:value)||'';
}
const profileName=process.env.ULTRON_HF_PROFILE;
const shard=Number(process.env.ULTRON_HF_SHARD);
const plan=admitFreeCpuTournament({
 repository:process.env.GITHUB_REPOSITORY,
 publicRepository:process.env.ULTRON_REPOSITORY_PUBLIC==='true',
 paidBudgetCents:0,runner:process.env.ULTRON_RUNNER_LABEL,
 gpu:'none',maxParallel:4,shards:2,
});
if(!plan.models.includes(profileName)||!Number.isInteger(shard)||
   shard<0||shard>=plan.shards)
 throw Error('Unapproved CPU model or shard');
const model=selectFreeModelProfile({ULTRON_MODEL_PROFILE:profileName},
 {evaluation:true});
const revision=await resolveEvaluationRevision(model);
const {env,pipeline}=await import('@huggingface/transformers');
env.allowRemoteModels=true;
env.allowLocalModels=false;
const started=performance.now();
const generator=await pipeline('text-generation',model.id,{
 device:model.device,dtype:model.dtype,revision,
});
const cases=[];
for(const item of CASES.filter((_,i)=>i%plan.shards===shard)){
 const messages=[{role:'system',content:
  'You repair one exact JavaScript source line. Output only the complete corrected code line.'},
  {role:'user',content:'Original line:\n'+item.original+
   '\nRequired change: '+item.instruction+'\nCorrected line:'}];
 const output=await generator(messages,{max_new_tokens:plan.maxNewTokens,
   do_sample:false,return_full_text:false});
 const response=generatedText(output).replace(/\r/g,'').trim();
 const passed=response.split('\n').some(line=>line.trim()===item.expected);
 cases.push({id:item.id,passed});
}
const receipt=makeCpuEvidence({profile:profileName,revision,
 shard,sourceSha:process.env.GITHUB_SHA,
 durationMs:Math.round(performance.now()-started),
 paidCents:0,cases});
await mkdir('artifacts/hf-free-cpu',{recursive:true});
const file='artifacts/hf-free-cpu/'+profileName+'-shard'+shard+'.json';
await writeFile(file,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({model:receipt.model,revision:receipt.revision,
 shard:receipt.shard,passed:receipt.passed,caseCount:receipt.caseCount,
 durationMs:receipt.durationMs,paidCents:receipt.paidCents,digest:receipt.digest}));
