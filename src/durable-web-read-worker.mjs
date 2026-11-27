/** Trusted host composition for read-only web tasks. No new queue, no
 * arbitrary browser script or credentials. Existing broker owns receipts. */
import {createCapabilityBroker} from './capability-bindings.mjs';
import {createPostgresCapabilityAttemptStore} from './capability-attempt-store.mjs';
import {selectWebReadBinding} from './universal-web-routing.mjs';
const held=reason=>Object.freeze({status:'held',reason,productionAccepted:false});
const pathPattern=/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const pathOk=p=>typeof p==='string'&&p.length<=512&&pathPattern.test(p)&&
 !p.split('/').some(x=>x==='.'||x==='..');
export function createDurableWebReadWorker({db,routes,clock,authorizeRead}={}){
 const attemptStore=createPostgresCapabilityAttemptStore({db});
 if(typeof authorizeRead!=='function'||!Array.isArray(routes)||routes.length>32)
  throw Error('web-worker-trusted-host-required');
 const broker=createCapabilityBroker({clock,attemptStore});
 const inventory=routes.map(({protocol,binding,adapter,allowedPaths})=>{
  if(!Array.isArray(allowedPaths)||!allowedPaths.length||allowedPaths.some(p=>!pathOk(p))||
    binding.operations.some(op=>op.effect!=='read'))throw Error('web-worker-read-scope-required');
  broker.bind(binding,adapter);
  return Object.freeze({protocol,bindingId:binding.id,allowedPaths:Object.freeze([...allowedPaths])});
 });
 return Object.freeze({async execute(raw){
  let r;
  try{
   const keys=['origin','actorRef','operation','scope','maxPaidCents','idempotencyKey','path'];
   const d=Object.getOwnPropertyDescriptors(raw);
   if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))
    return held('invalid-web-task');
   r=Object.freeze(Object.fromEntries(keys.map(k=>[k,d[k].value])));
   if(r.operation!=='page.inspect'||r.scope!=='page.read'||r.maxPaidCents!==0||
     !pathOk(r.path)||typeof r.origin!=='string'||typeof r.actorRef!=='string'||
     typeof r.idempotencyKey!=='string'||!/^[a-z0-9][a-z0-9_.:-]{7,127}$/i.test(r.idempotencyKey))
    return held('invalid-web-task');
   const u=new URL(r.origin);
   if(u.origin!==r.origin||u.protocol!=='https:')return held('invalid-origin');
   if(await authorizeRead(r)!==true)return held('read-authorization-required');
   const {path,idempotencyKey,...request}=r;
   // Probe only configured routes for this exact operation and identity.
   // Do not skip a denied higher-priority binding.
   for(const entry of inventory){
    const b=broker.status(entry.bindingId);
    if(b.operations.some(op=>op.name===r.operation)&&b.origins.includes(r.origin)&&b.actorRef===r.actorRef)
     await broker.health(entry.bindingId);
   }
   const selected=selectWebReadBinding({broker,request,
    candidates:inventory.map(({protocol,bindingId})=>({protocol,bindingId}))});
   if(selected.status!=='selected')return selected;
   const chosen=inventory.find(x=>x.bindingId===selected.bindingId);
   if(!chosen.allowedPaths.includes(path))return held('path-not-admitted');
   if(await authorizeRead(r)!==true)return held('read-authorization-required');
   const receipt=await broker.execute(selected.bindingId,{operation:r.operation,idempotencyKey,
    estimatedCostCents:0,input:{url:r.origin+path},expected:{origin:r.origin}});
   return Object.freeze({...receipt,productionAccepted:false});
  }catch{return held('web-worker-state-unavailable');}
 }});
}
