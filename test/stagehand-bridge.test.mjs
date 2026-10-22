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
    '#save':{tag:'BUTTON',type:'',disabled:false,html:'<button id="save">Save</button>'},
    '#not-allowed':{tag:'SCRIPT',disabled:false,html:'<script id="not-allowed"></script>'},
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
    async evaluate(_fn,selector){const shape=selectorShape[selector];return shape?{html:'<'+shape.tag.toLowerCase()+'>',...shape}:null},
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
  return {page,agent,state,events,selectorShape,get acts(){return calls}};
}
test('Stagehand v4 asynchronous URL is normalized for Ultron executor',async()=>{
  const f=fixture(),driver=createStagehandPageDriver(f.page,{verifyTarget:async()=>true});
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

test('long-page postconditions are verified beyond the visible text limit',async()=>{
  const f=fixture(),base='x'.repeat(15000);
  f.state.text=base+' Initial';
  const original=f.page.locator.bind(f.page);
  f.page.locator=selector=>{
    const loc=original(selector);
    if(selector==='#save')return {...loc,async click(){
      f.events.push(['click',selector]);
      f.state.text=base+' Saved successfully at page tail';
    }};
    return loc;
  };
  const driver=createStagehandPageDriver(f.page,{verifyTarget:async()=>true});
  const before=await driver.observe({textIncludes:'Saved successfully at page tail'});
  assert.ok(before.text.length<=10000);
  const runner=createComputerExecutor({
    driver,store:createMemoryComputerStore(),
    allowedOrigins:[origin],authorize:async()=>true,
  });
  const out=await runner.run({id:'long-page-click',steps:[{
    action:'click',selector:'#save',
    expect:{textIncludes:'Saved successfully at page tail'}
  }]});
  const after=await driver.observe({textIncludes:'Saved successfully at page tail'});
  assert.equal(out.status,'completed');
  assert.equal(out.receipts.length,1);
  assert.ok(after.text.length<=10000);
  assert.ok(after.text.includes('Saved successfully at page tail'));
  assert.notEqual(before.textDigest,after.textDigest);
  assert.equal(f.events.length,1);
});
test('tail-only changes are detectable even without an expected text excerpt',async()=>{
  const f=fixture(),base='z'.repeat(15000);
  f.state.text=base+' old';
  const driver=createStagehandPageDriver(f.page);
  const before=await driver.observe({urlIncludes:'/foo'});
  f.state.text=base+' new';
  const after=await driver.observe({urlIncludes:'/foo'});
  assert.equal(before.text,after.text);
  assert.notEqual(before.textDigest,after.textDigest);
});
test('model-proposed target must be rechecked before dispatch',async()=>{
  const f=fixture(),observer=createStagehandSelectorObserver({
    agent:f.agent,page:f.page,allowedOrigins:[origin]});
  const button=await observer.suggest({
    instruction:'Find the synthetic Save button',action:'click'});
  const driver=createStagehandPageDriver(f.page,{verifyTarget:observer.verifyTarget});
  assert.equal(await observer.verifyTarget(button),true);
  f.selectorShape['#save'].html='<button id="save" data-action="changed">Delete</button>';
  assert.equal(await observer.verifyTarget(button),false);
  await assert.rejects(driver.perform({
    action:'click',selector:button.selector
  }),/stale/);
  assert.equal(f.events.length,0);
  f.selectorShape['#save'].html='<button id="save">Save</button>';
  await f.page.goto(origin+'/different-page');
  assert.equal(await observer.verifyTarget(button),false);
});
test('unguarded AI interactive adapter fails closed',async()=>{
  const f=fixture();
  const driver=createStagehandPageDriver(f.page);
  await assert.rejects(driver.perform({action:'click',selector:'#save'}),/stale/);
  await assert.rejects(driver.perform({
    action:'type',selector:'#save',value:'x'
  }),/stale/);
  assert.equal(f.events.length,0);
});
