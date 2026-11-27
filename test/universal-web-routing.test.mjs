import test from 'node:test';
import assert from 'node:assert/strict';
import {selectWebReadBinding} from '../src/universal-web-routing.mjs';
import {createCapabilityBroker} from '../src/capability-bindings.mjs';

const origin='https://ultron-mw-cloud.hatchable.site';
const actorRef='owner:ultron';
const request={origin,actorRef,operation:'page.inspect',scope:'page.read',maxPaidCents:0};
const now='2026-11-26T00:00:00Z';
function binding(id,overrides={}){
 return {id,provider:id,runtime:'local-node',actorRef,authMethod:'local-owner',
  origins:[origin],operations:[{name:'page.inspect',effect:'read',scope:'page.read'}],
  expiresAt:'2026-11-27T00:00:00Z',maxCostCents:0,credentialRef:null,...overrides};
}
async function fixture(configs){
 const broker=createCapabilityBroker({clock:()=>now});
 const candidates=[];
 for(const [protocol,id,overrides={},health='ready'] of configs){
  broker.bind(binding(id,overrides),{
   health:async()=>({status:health,actorRef,grantedScopes:['page.read']}),
   execute:async()=>{throw Error('Router must never execute')},
   observe:async()=>{throw Error('Router must never observe')},unbind:async()=>({revoked:true})
  });
  await broker.health(id);
  candidates.push({protocol,bindingId:id});
 }
 return {broker,candidates,request};
}
test('native API wins over browser protocol independent of configuration order',async()=>{
 const f=await fixture([['bidi','bidi-owner'],['openapi','api-owner']]);
 assert.deepEqual(selectWebReadBinding(f),{status:'selected',protocol:'openapi',bindingId:'api-owner',productionAccepted:false});
});
test('only an absent operation permits selecting the next interface',async()=>{
 const f=await fixture([['openapi','api-owner',{operations:[{name:'other.read',effect:'read',scope:'page.read'}]}],['bidi','bidi-owner']]);
 assert.equal(selectWebReadBinding(f).bindingId,'bidi-owner');
});
test('revocation or non-ready API never falls through to browser',async()=>{
 const f=await fixture([['openapi','api-owner',{},'revoked'],['bidi','bidi-owner']]);
 assert.equal(selectWebReadBinding(f).status,'held');
});
test('foreign origin, actor, paid binding, scope mismatch and write are held',async()=>{
 for(const overrides of [{origins:['https://example.com']},{actorRef:'other:owner'},
  {maxCostCents:1},{operations:[{name:'page.inspect',effect:'read',scope:'other.read'}]},
  {operations:[{name:'page.inspect',effect:'write',scope:'page.read'}]}]){
  const f=await fixture([['openapi','api-owner',overrides],['bidi','bidi-owner']]);
  assert.equal(selectWebReadBinding(f).status,'held');
 }
});
test('unknown protocol, duplicate binding, nonzero cost, internal URL and extra fields are held',async()=>{
 const f=await fixture([['bidi','bidi-owner']]);
 for(const value of [{...f,candidates:[{protocol:'arbitrary',bindingId:'bidi-owner'}]},
  {...f,candidates:[...f.candidates,...f.candidates]},
  {...f,request:{...request,maxPaidCents:1}},
  {...f,request:{...request,origin:'chrome://settings'}},
  {...f,request:{...request,script:'arbitrary'}}]){
  assert.equal(selectWebReadBinding(value).status,'held');
 }
});
test('unavailable status is held and does not attempt another route',async()=>{
 const f=await fixture([['bidi','bidi-owner']]);
 assert.equal(selectWebReadBinding({...f,candidates:[{protocol:'openapi',bindingId:'unknown'},...f.candidates]}).status,'held');
});

test('malformed or hostile input never supplies a routing authority',async()=>{
 const f=await fixture([['bidi','bidi-owner']]);
 const traps=new Proxy(request,{ownKeys(){throw Error('trap')}});
 assert.equal(selectWebReadBinding({...f,request:traps}).status,'held');
 assert.equal(selectWebReadBinding({...f,request:{...request,actorRef:[actorRef]}}).status,'held');
 assert.equal(selectWebReadBinding({...f,request:{...request,scope:{toString(){return 'page.read'}}}}).status,'held');
});
