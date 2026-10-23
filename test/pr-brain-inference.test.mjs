import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPrInference } from '../src/pr-brain-inference.mjs';

const messages=[{role:'system',content:'Edit one exact line.'},
  {role:'user',content:'Return the replacement line.'}];

test('local inference is the default and does not need an API key',()=>{
  const lane=selectPrInference({env:{}});
  assert.equal(lane.provider,'local-cpu');
  assert.equal(lane.model,'onnx-community/Qwen2.5-0.5B-Instruct');
});

test('selected OpenAI model returns only completed text and keeps key outside the prompt',async()=>{
  const requests=[];
  const lane=selectPrInference({env:{ULTRON_MODEL_PROVIDER:'openai',
    ULTRON_MODEL:'gpt-6-astra',OPENAI_API_KEY:'sk-test-not-real'},
  fetchImpl:async(url,init)=>{requests.push({url,init});return {ok:true,
    json:async()=>({status:'completed',output:[{type:'reasoning'},
      {type:'message',content:[{type:'output_text',text:'const x=2;'}]}]})};}});
  assert.equal(await lane.run(messages),'const x=2;');
  assert.equal(lane.model,'gpt-6-astra');
  assert.equal(requests[0].url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(requests[0].init.body);
  assert.equal(body.store,false);
  assert.equal(body.model,'gpt-6-astra');
  assert.equal(JSON.stringify(body).includes('sk-test-not-real'),false);
});

test('missing credentials, invalid models and incomplete results fail closed',async()=>{
  assert.throws(()=>selectPrInference({env:{ULTRON_MODEL_PROVIDER:'openai'}}),/API key/);
  assert.throws(()=>selectPrInference({env:{ULTRON_MODEL_PROVIDER:'openai',
    ULTRON_MODEL:'unknown',OPENAI_API_KEY:'sk-test'}}),/model selection/);
  assert.throws(()=>selectPrInference({env:{ULTRON_MODEL_PROVIDER:'unknown'}}),/Unsupported/);
  const lane=selectPrInference({env:{ULTRON_MODEL_PROVIDER:'openai',OPENAI_API_KEY:'sk-test'},
    fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})});
  await assert.rejects(()=>lane.run(messages),/incomplete/);
});
