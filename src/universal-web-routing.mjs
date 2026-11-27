/** Select an already registered, independently checked read capability.
 * This is not a browser executor, network probe or grant issuer. Only the
 * trusted host supplies broker/candidates; page content cannot register them.
 * A denial or ambiguous state never falls through to another interface.
 */
const order=Object.freeze(['openapi','graphql','mcp','webmcp','bidi','cdp','playwright','semantic-ui']);
const name=/^[a-z][a-z0-9_.:-]{1,79}$/;
const actor=/^[a-z0-9][a-z0-9:._-]{2,127}$/i;
const id=/^[a-z][a-z0-9_.-]{2,79}$/;
const held=reason=>Object.freeze({status:'held',reason,productionAccepted:false});
function exact(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('shape');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||
    !keys.every(k=>descriptors[k]?.enumerable&&Object.hasOwn(descriptors[k],'value')))
  throw Error('shape');
 return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
function originAllowed(raw){
 if(typeof raw!=='string')return false;
 const u=new URL(raw);
 return typeof raw==='string'&&u.origin===raw&&u.protocol==='https:'&&!u.username&&!u.password;
}
export function selectWebReadBinding({broker,candidates,request}={}){
 try{
  const r=exact(request,['origin','actorRef','operation','scope','maxPaidCents']);
  if(!originAllowed(r.origin)||typeof r.actorRef!=='string'||typeof r.operation!=='string'||
     !actor.test(r.actorRef)||!name.test(r.operation)||
     typeof r.scope!=='string'||!name.test(r.scope)||r.maxPaidCents!==0||
     typeof broker?.status!=='function'||!Array.isArray(candidates)||candidates.length>32)
   return held('invalid-routing-request');
  const routes=candidates.map(c=>exact(c,['protocol','bindingId']));
  if(routes.some(c=>!order.includes(c.protocol)||typeof c.bindingId!=='string'||!id.test(c.bindingId))||
     new Set(routes.map(c=>c.bindingId)).size!==routes.length)
   return held('invalid-route-registry');
  routes.sort((a,b)=>order.indexOf(a.protocol)-order.indexOf(b.protocol)||
   a.bindingId.localeCompare(b.bindingId));
  for(const c of routes){
   const b=broker.status(c.bindingId);
   if(b?.schema!=='ultron.binding.v1'||b.id!==c.bindingId||
      !Array.isArray(b.operations)||!Array.isArray(b.origins))
    return held('binding-status-unavailable');
   const operation=b.operations.find(x=>x.name===r.operation);
   // Only a known absence of the requested operation is unsupported.
   if(!operation)continue;
   if(b.actorRef!==r.actorRef||!b.origins.includes(r.origin)||b.maxCostCents!==0||
      operation.effect!=='read'||operation.scope!==r.scope||b.readiness!=='ready')
    return held('binding-scope-or-readiness-denied');
   return Object.freeze({status:'selected',protocol:c.protocol,
    bindingId:c.bindingId,productionAccepted:false});
  }
  return held('capability-unsupported');
 }catch{return held('routing-state-unavailable');}
}
