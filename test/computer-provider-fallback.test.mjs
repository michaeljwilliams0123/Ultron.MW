import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderFirstExecutor } from '../src/computer/provider-fallback.mjs';
import { createMemoryComputerStore } from '../src/computer/executor.mjs';

const binding = { id:'fallback',kind:'computer.browser',runtime:'local-node',
  enabled:true,allowedOrigins:['https://example.com'],
  operations:['navigate','observe'],maxSteps:2 };
const plan = { id:'fallback-plan',steps:[
  {action:'navigate',url:'https://example.com/'},{action:'observe'},
] };
function harness(provider) {
  let launches=0,closes=0;
  const memory=createMemoryComputerStore();
  const store={...memory,withLock:async(_id,fn)=>fn()};
  let url='about:blank';
  const driver={observe:async()=>({url,text:'ready'}),
    perform:async step=>{ if(step.action==='navigate')url=step.url; }};
  const executor=createProviderFirstExecutor({binding,store,provider,
    authorize:async()=>true,canContinue:async()=>true,
    launch:async options=>{
      launches++;
      assert.equal(options.headless,true);
      assert.deepEqual(options.allowedOrigins,['https://example.com']);
      return {driver,close:async()=>{closes++;}};
    }});
  return {executor,get launches(){return launches;},get closes(){return closes;}};
}
test('provider result is preferred and never opens a browser',async()=>{
  for (const status of ['completed','held','reconcile-required']) {
    const h=harness(async()=>({status}));
    assert.equal((await h.executor.run({request:{},plan})).route,'provider');
    assert.equal(h.launches,0);
  }
});
test('fallback requires explicit unsupported before dispatch',async()=>{
  const h=harness(async()=>({status:'unsupported',dispatched:false}));
  const result=await h.executor.run({request:{},plan});
  assert.equal(result.route,'browser');
  assert.equal(result.result.status,'completed');
  assert.equal(h.launches,1);
  assert.equal(h.closes,1);
});
test('uncertain, thrown or malformed provider results never open a browser',async()=>{
  for (const provider of [
    async()=>({status:'unsupported'}),async()=>({status:'unsupported',dispatched:true}),
    async()=>({status:'unknown'}),async()=>{throw Error('network uncertain');},
  ]) {
    const h=harness(provider);
    await assert.rejects(h.executor.run({request:{},plan}));
    assert.equal(h.launches,0);
  }
});
test('binding restrictions and executor origin checks remain enforced',async()=>{
  const h=harness(async()=>({status:'unsupported',dispatched:false}));
  await assert.rejects(h.executor.run({plan:{...plan,steps:[{action:'click',selector:'button'}]}}),
    /exceeds binding/);
  assert.equal(h.launches,0);
  await assert.rejects(h.executor.run({plan:{...plan,steps:[{action:'navigate',url:'https://other.example/'}]}}),
    /origin not admitted/);
  assert.equal(h.closes,0);
});
test('fallback preserves the executor approval requirement for active actions',async()=>{
  const activeBinding={...binding,operations:['navigate','click']};
  const memory=createMemoryComputerStore();
  const store={...memory,withLock:async(_id,fn)=>fn()};
  let url='about:blank',clicks=0,closes=0;
  const driver={observe:async()=>({url,text:'ready'}),
    perform:async step=>{if(step.action==='navigate')url=step.url;else clicks++;}};
  const executor=createProviderFirstExecutor({binding:activeBinding,store,
    provider:async()=>({status:'unsupported',dispatched:false}),
    authorize:async()=>false,canContinue:async()=>true,
    launch:async()=>({driver,close:async()=>{closes++;}})});
  const result=await executor.run({plan:{id:'approval-test',steps:[
    {action:'navigate',url:'https://example.com/'},
    {action:'click',selector:'button',expect:{textIncludes:'done'}},
  ]}});
  assert.equal(result.result.status,'approval-required');
  assert.equal(clicks,0);
  assert.equal(closes,1);
});
test('missing durable lock or owner authority is rejected',()=>{
  assert.throws(()=>createProviderFirstExecutor({binding,store:createMemoryComputerStore(),
    provider:async()=>({status:'unsupported',dispatched:false})}),/durable lock/);
});
test('binding changes after construction cannot expand network policy',async()=>{
  const mutable={...binding,allowedOrigins:['https://example.com'],operations:['navigate']};
  const memory=createMemoryComputerStore();
  const store={...memory,withLock:async(_id,fn)=>fn()};
  let launches=0;
  const executor=createProviderFirstExecutor({binding:mutable,store,
    provider:async()=>({status:'unsupported',dispatched:false}),
    authorize:async()=>true,canContinue:async()=>true,
    launch:async()=>{launches++;throw Error('must not launch');}});
  mutable.allowedOrigins.push('https://other.example');
  await assert.rejects(executor.run({plan:{id:'pin',steps:[
    {action:'navigate',url:'https://other.example/'}
  ]}}),/origin not admitted/);
  assert.equal(launches,0);
});
test('deadline closes the browser and a late owner approval cannot dispatch',async()=>{
  const store=createMemoryComputerStore();
  let release,entered,clicks=0,closes=0;
  const approvalEntered=new Promise(resolve=>{entered=resolve;});
  const approval=new Promise(resolve=>{release=resolve;});
  const driver={observe:async()=>({url:'https://example.com/',text:'ready'}),
    perform:async()=>{clicks++;}};
  const executor=createProviderFirstExecutor({
    binding:{...binding,operations:['click']},store,browserDeadlineMs:30,
    provider:async()=>({status:'unsupported',dispatched:false}),
    canContinue:async()=>true,authorize:async()=>{entered();return approval;},
    launch:async()=>({driver,close:async()=>{closes++;}}),
  });
  const activePlan={id:'deadline-approval',steps:[
    {action:'click',selector:'button',expect:{textIncludes:'done'}},
  ]};
  const running=executor.run({plan:activePlan});
  await approvalEntered;
  const result=await running;
  assert.equal(result.result.status,'reconcile-required');
  assert.equal(closes,1);
  assert.equal(clicks,0);
  await assert.rejects(executor.run({plan:activePlan}),/already running/);
  release(true);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(clicks,0);
});
test('deadline after dispatch reports uncertainty and never repeats the action',async()=>{
  const store=createMemoryComputerStore();
  let release,entered,clicks=0;
  const dispatched=new Promise(resolve=>{entered=resolve;});
  const performing=new Promise(resolve=>{release=resolve;});
  const driver={observe:async()=>({url:'https://example.com/',text:'ready'}),
    perform:async()=>{clicks++;entered();await performing;}};
  const executor=createProviderFirstExecutor({
    binding:{...binding,operations:['click']},store,browserDeadlineMs:30,
    provider:async()=>({status:'unsupported',dispatched:false}),
    canContinue:async()=>true,authorize:async()=>true,
    launch:async()=>({driver,close:async()=>{release();}}),
  });
  const running=executor.run({plan:{id:'deadline-dispatch',steps:[
    {action:'click',selector:'button',expect:{textIncludes:'done'}},
  ]}});
  await dispatched;
  assert.equal((await running).result.status,'reconcile-required');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(clicks,1);
  assert.equal((await store.read('deadline-dispatch')).pending,'step-1');
});
test('invalid browser execution deadlines are rejected',()=>{
  for(const browserDeadlineMs of [0,120001,1.5]){
    assert.throws(()=>createProviderFirstExecutor({binding,store:createMemoryComputerStore(),
      provider:async()=>({status:'unsupported',dispatched:false}),authorize:async()=>true,
      canContinue:async()=>true,browserDeadlineMs}),/requires an enabled binding/);
  }
});
