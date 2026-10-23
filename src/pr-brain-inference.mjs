import { localCpuInference } from './pr-brain-model.mjs';

const MODELS=new Set(['gpt-6-astra','gpt-6.1-sol','gpt-6-luna']);
const API='https://api.openai.com/v1/responses';

export function selectPrInference({env=process.env,fetchImpl=fetch}={}) {
  const provider=env.ULTRON_MODEL_PROVIDER||'local-cpu';
  if(provider==='local-cpu')return Object.freeze({
    run:localCpuInference,provider:'local-cpu',
    model:'onnx-community/Qwen2.5-0.5B-Instruct',
    generatedBy:'public-CPU-ONNX-inference',
  });
  if(provider!=='openai')throw Error('Unsupported Ultron model provider');
  const model=env.ULTRON_MODEL||'gpt-6.1-sol';
  if(!MODELS.has(model))throw Error('Unapproved OpenAI model selection');
  if(typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.startsWith('sk-'))
    throw Error('OpenAI provider selected without a configured API key');
  if(typeof fetchImpl!=='function')throw Error('OpenAI transport unavailable');
  return Object.freeze({
    provider:'openai',model,generatedBy:'OpenAI-Responses-API',
    run:async messages=>{
      if(!Array.isArray(messages)||messages.length!==2||
        messages[0]?.role!=='system'||messages[1]?.role!=='user'||
        messages.some(x=>typeof x.content!=='string'||x.content.length>12000))
        throw Error('Invalid bounded model prompt');
      const response=await fetchImpl(API,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.OPENAI_API_KEY},
        body:JSON.stringify({model,instructions:messages[0].content,
          input:messages[1].content,max_output_tokens:2048,store:false,
          reasoning:{effort:model==='gpt-6-luna'?'low':'medium'}}),
        signal:AbortSignal.timeout(120000),
      });
      if(!response.ok)throw Error('OpenAI request failed (HTTP '+response.status+')');
      const result=await response.json();
      if(result?.status!=='completed'||!Array.isArray(result.output))
        throw Error('OpenAI response was incomplete');
      const content=result.output.flatMap(item=>item.type==='message'?
        (item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text):[])
        .join('\n').trim();
      if(!content||content.length>15000)
        throw Error('OpenAI response supplied no bounded source proposal');
      return content;
    },
  });
}
