import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStagehandPageDriver, createStagehandSelectorObserver,
  createStagehandOllamaModel, createOptionalSqliteGraphCheckpointer,
} from '../src/computer/stagehand-bridge.mjs';
import {createMemoryComputerStore,createComputerExecutor}
  from '../src/computer/executor.mjs';

const origin='http://127.0.0.1:45161';
function fixture(){
  const state={url:origin+'/',title:'Test Form',text:'Before'};
  const events=[];
  const selectorShape={
    'xpath=//input[@id="alias"]':{tag:'INPUT',type:'text',disabled:false},
    '#save':{tag:'BUTTON',type:'',disabled:false},
    '#not-allowed':{tag:'SCRIPT',disabled:false},
  };
  let calls=0;
  const page={
    async url(){return state.url;},
    async title(){return state.title;},
    locator(selector){
      return {
        async count(){return selectorShape[selector]?1:0},
        async innerText(){return state.text},
        async click(){events.push(['click',selector]);state.text='Submitted'},
        async fill(value){events.push(['fill',selector]);state.input=value;},
        async inputValue(){return state.input;},
      };
    },
    async evaluate(_fn,selector){return selectorShape[selector]??null},
    async goto(url){events.push(['goto',url]);state.url=url},
    async waitForSelector(selector){events.push(['wait',selector])},
  };
  const agent={
    act(){calls++;throw Error('agent.act must never execute')},
    async observe(){return {data:[
      {selector:'#not-allowed',method:'click'},
      {selector:'xpath=//input[@id="alias"]',method:'fill'},
      {selector:'#save',method:'click'}
    ]}},
  };
  return {page,agent,state,events,get acts(){return calls}};
}
test('Stagehand v4 asynchronous URL is normalized for Ultron executor',async()=>{
  const f=fixture(),driver=createStagehandPageDriver(f.page);
  assert.equal((await driver.observe()).url,origin+'/');
  assert.equal((await driver.perform({action:'type',selector:'xpath=//input[@id="alias"]',
    value:'synthetic'})).fieldValueVerified,true);
  assert.equal((await driver.perform({action:'observe'})),null);
  assert.deepEqual(f.events,[['fill','xpath=//input[@id="alias"]']]);
  await assert.rejects(driver.perform({action:'keypress',selector:'#save',key:'Enter'}),
    /Unsupported/);
});
test('AI proposal is constrained to one DOM verified action, never calls act',async()=>{
  const f=fixture(),observer=createStagehandSelectorObserver({
    agent:f.agent,page:f.page,allowedOrigins:[origin]});
  const field=await observer.suggest({instruction:'Find the synthetic alias input',action:'type'});
  const button=await observer.suggest({instruction:'Find the synthetic save button',action:'click'});
  assert.equal(field.selector,'xpath=//input[@id="alias"]');
  assert.equal(button.selector,'#save');
  assert.equal(f.acts,0);
  assert.equal(field.evidence,'single-DOM-element');
});
test('foreign origin and unverified selectors fail closed',async()=>{
  const f=fixture(),observer=createStagehandSelectorObserver({
    agent:f.agent,page:f.page,allowedOrigins:[origin]});
  f.state.url='https://external.example/';
  await assert.rejects(observer.suggest({instruction:'Find the synthetic alias input',
    action:'type'}),/not allowed/);
  assert.equal(f.acts,0);
  f.state.url=origin+'/';
  const denial=createStagehandSelectorObserver({
    agent:{observe:async()=>({data:[{selector:'#not-allowed',method:'click'}]})},
    page:f.page,allowedOrigins:[origin]});
  await assert.rejects(denial.suggest({instruction:'Find the synthetic button',
    action:'click'}),/No verified/);
});
test('Stagehand model callback reuses existing Ollama structured adapter',async()=>{
  const messages=[];
  const ollama={respond:async input=>{messages.push(input);return {
    model:'qwen3:8b',decision:{elements:[{selector:'#save',method:'click'}]}
  }}};
  const model=createStagehandOllamaModel(ollama);
  const r=await model.generate({
    systemPrompt:'Return the identified element',
    messages:[{role:'user',content:[{type:'text',text:'Find button'}]}],
    responseFormat:{schema:{type:'object',properties:{elements:{type:'array'}}}}
  });
  assert.equal(r.outputFormat,'json_schema');
  assert.equal(r.structuredContent.elements[0].selector,'#save');
  assert.equal(messages.length,1);
  assert.equal(messages[0][0].role,'system');
  assert.match(messages[0][0].content,/Required schema:/);
  await assert.rejects(model.generate({messages:[{content:[{type:'image',
    image:'private'}]}]}),/Non-text/);
});
test('Stagehand model cannot authorize Ultron browser actions',async()=>{
  const f=fixture(),store=createMemoryComputerStore();
  const worker=createComputerExecutor({
    driver:createStagehandPageDriver(f.page),store,allowedOrigins:[origin],
    authorize:async()=>false,
  });
  const result=await worker.run({id:'stagehand-no-approval',
    steps:[{action:'click',selector:'#save',expect:{textIncludes:'Submitted'}}]});
  assert.equal(result.status,'approval-required');
  assert.equal(f.events.length,0);
  assert.equal(f.acts,0);
});
test('SQLite adapter is optional and refuses in-memory persistence',()=>{
  assert.throws(()=>createOptionalSqliteGraphCheckpointer({
    SqliteSaver:{fromConnString:()=>{}},databasePath:':memory:'}),/Durable/);
  const saver=createOptionalSqliteGraphCheckpointer({
    SqliteSaver:{fromConnString:path=>({path})},databasePath:'D:/local/ultron.db'});
  assert.equal(saver.path,'D:/local/ultron.db');
});
