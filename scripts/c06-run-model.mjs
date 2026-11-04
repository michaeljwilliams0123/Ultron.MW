/** Read-only public-CPU model generation. No GitHub token or paid inference. */
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {admitC06,buildC06Artifacts,C06_PATHS} from '../src/c06-model-origin.mjs';
import {FREE_CPU_MODELS} from '../src/hf-free-compute.mjs';

const sourceSha=process.env.GITHUB_SHA;
const runId=process.env.GITHUB_RUN_ID;
const admission=admitC06({
 repository:process.env.GITHUB_REPOSITORY,actor:process.env.GITHUB_ACTOR,
 publicRepository:process.env.ULTRON_REPOSITORY_PUBLIC==='true',
 paidBudgetCents:Number(process.env.ULTRON_PAID_BUDGET_CENTS),
 sourceSha,issueNumber:Number(process.env.ULTRON_C06_ISSUE),
 runner:process.env.ULTRON_RUNNER_LABEL
});
const expected=FREE_CPU_MODELS['coder-medium'];
if(admission.model!==expected.id||admission.revision!==
 '774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf')
 throw Error('c06-model-revision-mismatch');
let currentStage='model-download';
try{
 const {env,pipeline}=await import('@huggingface/transformers');
 env.allowLocalModels=false;
 env.allowRemoteModels=true;
 const generator=await pipeline('text-generation',admission.model,
  {device:'cpu',dtype:'q4',revision:admission.revision});
 const infer=async(kind,messages,attempt)=>{
  currentStage=kind+'-attempt-'+attempt;
  const output=await generator(messages,{max_new_tokens:
    kind==='doc-section'?150:kind==='case'?180:kind==='docs'?320:550,
   do_sample:false,return_full_text:false});
  const raw=output?.[0]?.generated_text;
  const response=Array.isArray(raw)?raw.at(-1)?.content:raw;
  if(typeof response!=='string'||response.length>4500)throw Error('c06-inference-invalid');
  return response;
 };
 const generated=await buildC06Artifacts({admission,runId,infer,maxAttempts:3});
 for(const [path,content] of Object.entries(generated.files)){
  const target=join('c06-output',path);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,content,{flag:'wx'});
 }
 const executable=spawnSync(process.execPath,['--test',
   'c06-output/'+C06_PATHS.tests],{encoding:'utf8',timeout:10000,
   maxBuffer:30000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 if(executable.error||executable.status!==0)
  throw Error('c06-model-generated-regression-failed');
 console.log(JSON.stringify({schema:'ultron.c06.cpu-generation.v1',
  status:'candidate-verified',sourceSha,runId,
  model:admission.model,revision:admission.revision,
  independentCaseCount:generated.receipt.independentCaseCount,
  independentCorrect:generated.receipt.independentCorrect,
  paths:Object.keys(generated.files),paidCents:0,
  receiptDigest:generated.receipt.receiptDigest}));
}catch(error){
 await mkdir('c06-output/evidence',{recursive:true});
 await writeFile('c06-output/evidence/c06-held.json',JSON.stringify({
  schema:'ultron.c06.generation-held.v1',status:'held',
  sourceSha,runId,stage:currentStage,reason:
   String(error?.message||'unknown').slice(0,240),paidCents:0,
  productionAccepted:false},null,2)+'\n');
 console.error('C06_HELD '+currentStage+': '+String(error?.message||'unknown').slice(0,240));
 process.exitCode=1;
}
