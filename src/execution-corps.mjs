/**
 * Execution-only workers. The trusted composition root supplies the existing
 * durable adapters; this module cannot grant authority, mint credentials,
 * bypass Council or accept provider/tool functions from an agent request.
 */
import {executeGitHubOperation} from './github-operation-executor.mjs';
import {runAutonomousRepair} from './autonomous-repair-loop.mjs';
import {executeUniversalCloudTask} from './universal-cloud-executor.mjs';

export const EXECUTION_AGENTS=Object.freeze([
 {id:'forge',purpose:'Execute authorized repository operations',boundary:'GitHub App and operation ledger'},
 {id:'medic',purpose:'Apply bounded repairs, verify and publish a PR',boundary:'Autonomous repair ledger and exact-head CI'},
 {id:'nexus',purpose:'Execute authorized cross-provider effects',boundary:'Signed intent, provider outbox and independent readback'},
 {id:'relay',purpose:'Execute authenticated Composio repository reads',boundary:'Scoped Composio v3 worker and durable read receipt'}
].map(a=>Object.freeze({...a,maxPaidCents:0})));

const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&
 Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable===true&&Object.hasOwn(d,'value');
 });
const held=reason=>Object.freeze({status:'held',reason,productionAccepted:false});
const uncertain=reason=>Object.freeze({status:'reconcile-required',reason,productionAccepted:false});
const observed=(agent,status,result)=>Object.freeze({agent,status,result,productionAccepted:false});
const validResult=(r,key)=>r&&typeof r==='object'&&typeof r[key]==='string';

/** Internal trusted composition API, never a public unauthenticated endpoint.
 * Admission and all durable effect/recovery semantics stay in existing executors.
 * A published repair PR or read receipt is not a verified production release.
 */
export function createExecutionCorps({githubServices,repairServices,cloudServices,composioWorker}={}){
 return Object.freeze({
  agents:EXECUTION_AGENTS,
  async execute(raw){
   // Reject top-level callback injection and unexpected arguments before dispatch.
   const agent=Object.getOwnPropertyDescriptor(raw??{},'agent')?.value;
   const keys=agent==='forge'||agent==='medic'?['agent','plan']:
    agent==='nexus'?['agent','task','ownerGrant','ownerApproval']:
    agent==='relay'?['agent','query']:null;
   if(!keys||!shape(raw,keys))return held('invalid-execution-request');
   let input;try{input=structuredClone(raw);}catch{return held('invalid-execution-payload');}
   try{
    if(agent==='forge'){
     if(!githubServices)return held('github-adapter-unbound');
     const r=await executeGitHubOperation(input.plan,githubServices);
     return validResult(r,'state')?observed(agent,r.state,r):uncertain('github-readback-unavailable');
    }
    if(agent==='medic'){
     if(!repairServices)return held('repair-adapter-unbound');
     const r=await runAutonomousRepair({...repairServices,plan:input.plan});
     return validResult(r,'status')?observed(agent,r.status==='completed'?'verified-pr-published':r.status,r):uncertain('repair-readback-unavailable');
    }
    if(agent==='nexus'){
     if(typeof cloudServices?.readRuntimeControl!=='function')return held('cloud-adapter-unbound');
     const runtimeControl=await cloudServices.readRuntimeControl();
     const r=await executeUniversalCloudTask({...cloudServices,task:input.task,
      ownerGrant:input.ownerGrant,ownerApproval:input.ownerApproval,runtimeControl,
      now:typeof cloudServices.clock==='function'?cloudServices.clock():new Date().toISOString()});
     return validResult(r,'status')?observed(agent,r.status,r):uncertain('cloud-readback-unavailable');
    }
    if(typeof composioWorker?.inspect!=='function')return held('composio-adapter-unbound');
    if(!shape(input.query,['profile','actor'])&&!shape(input.query,['profile','actor','grant']))
     return held('invalid-composio-query');
    const r=await composioWorker.inspect(input.query);
    if(r?.schema!=='ultron.composio.v3.read-receipt'||r.verified!==true||
      r.effect!=='read'||r.actor!==input.query.actor||r.repositoryId!==1424939667||
      typeof r.receiptKey!=='string'||!r.receiptKey)
     return uncertain('composio-receipt-unverified');
    return observed(agent,'observed-read',{schema:r.schema,verified:true,effect:'read',
      actor:r.actor,repositoryId:r.repositoryId,receiptKey:r.receiptKey});
   }catch{
    // Errors may occur after a provider accepted an effect. Never replay here.
    return uncertain('executor-outcome-unavailable');
   }
  }
 });
}
