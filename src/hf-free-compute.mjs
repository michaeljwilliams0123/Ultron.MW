/** Zero-paid, public-runner model portfolio shared by PR brain and CPU evaluation.
 * Candidate models are advisory until a separate independently tested promotion.
 * No paid HF Jobs, Inference Providers, large GPU runners or credentials.
 */
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{40}$/;
const OWNER_REPO='michaeljwilliams0123/Ultron.MW';
export const FREE_CPU_MODELS=Object.freeze({
 baseline:Object.freeze({key:'baseline',id:'onnx-community/Qwen2.5-0.5B-Instruct',
  revision:'516c8d04add8a80c5228f32102b57953b8d421a9',
  device:'cpu',dtype:'q4',priceCents:0}),
 'coder-small':Object.freeze({key:'coder-small',
  id:'onnx-community/Qwen2.5-Coder-0.5B-Instruct',revision:null,
  device:'cpu',dtype:'q4',priceCents:0}),
 'coder-medium':Object.freeze({key:'coder-medium',
  id:'onnx-community/Qwen2.5-Coder-1.5B-Instruct',revision:null,
  device:'cpu',dtype:'q4',priceCents:0}),
 'coder-large':Object.freeze({key:'coder-large',
  id:'onnx-community/Qwen2.5-Coder-3B-Instruct',
  revision:'0e076a9c5291f8c74b3ce1558f21336b18f94739',
  device:'cpu',dtype:'q4',priceCents:0}),
});

export function selectFreeModelProfile(env={}, {evaluation=false}={}){
 const key=env?.ULTRON_MODEL_PROFILE??'baseline';
 if(typeof key!=='string'||!Object.hasOwn(FREE_CPU_MODELS,key))
  throw Error('unapproved-free-model-profile');
 if(!evaluation&&key!=='baseline')throw Error('free-model-not-promoted');
 return FREE_CPU_MODELS[key];
}

/** Require an exact 40-hex revision at the model provider before evaluating. */
export async function resolveEvaluationRevision(model,{fetchImpl=fetch}={}){
 if(!model||FREE_CPU_MODELS[model.key]!==model)
  throw Error('model-revision-unavailable');
 if(SHA.test(model.revision||''))return model.revision;
 if(typeof fetchImpl!=='function')throw Error('model-revision-unavailable');
 try{
  const response=await fetchImpl('https://huggingface.co/api/models/'+model.id,{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(!response?.ok)throw Error('model-api-unavailable');
  const metadata=await response.json();
  if(!SHA.test(metadata?.sha||''))throw Error('model-sha-invalid');
  return metadata.sha;
 }catch{throw Error('model-revision-unavailable');}
}

export function admitFreeCpuTournament(input={}){
 const fail=()=>{throw Error('free-cpu-admission-denied');};
 if(input.repository!==OWNER_REPO||input.publicRepository!==true||
    input.paidBudgetCents!==0||input.runner!=='ubuntu-24.04'||
    input.gpu!=='none'||input.maxParallel!==4||input.shards!==2)
  fail();
 return Object.freeze({
  schema:'ultron.hf.free-cpu-plan.v1',repository:OWNER_REPO,
  runner:'ubuntu-24.04',maxParallel:4,parallelVcpus:16,
  parallelRamGiB:64,shards:2,
  models:Object.freeze(Object.keys(FREE_CPU_MODELS)),
  maxNewTokens:128,paidBudgetCents:0,gpu:'none',
  runtime:'github-actions-public-standard',promotion:'advisory-only',
 });
}

export function makeCpuEvidence(input){
 const fail=()=>{throw Error('invalid-free-cpu-evidence');};
 if(!input||!Object.hasOwn(FREE_CPU_MODELS,input.profile)||
    !SHA.test(input.revision||'')||!SHA.test(input.sourceSha||'')||
    !Number.isSafeInteger(input.shard)||input.shard<0||input.shard>1||
    !Number.isSafeInteger(input.durationMs)||input.durationMs<0||
    input.paidCents!==0||!Array.isArray(input.cases)||
    input.cases.length<1||input.cases.length>16||
    input.cases.some(c=>typeof c?.id!=='string'||
     !/^[a-z0-9][a-z0-9-]{1,55}$/.test(c.id)||typeof c.passed!=='boolean')||
    new Set(input.cases.map(c=>c.id)).size!==input.cases.length)
  fail();
 const immutable={schema:'ultron.hf.free-cpu-eval.v1',
  profile:input.profile,model:FREE_CPU_MODELS[input.profile].id,
  revision:input.revision,sourceSha:input.sourceSha,
  shard:input.shard,durationMs:input.durationMs,paidCents:0,
  caseCount:input.cases.length,passed:input.cases.filter(c=>c.passed).length,
  cases:input.cases.map(c=>({id:c.id,passed:c.passed}))};
 const digest=createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
 return Object.freeze({...immutable,digest});
}
