import {createHash} from 'node:crypto';

/**
 * C06 bounded multi-step owner task sequencer.
 * This is an orchestration contract, NOT an independently enrolled GitHub
 * identity or permission to mutate production. Runtime adapters must return
 * authenticated authority and postcondition readback, not generated claims.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[a-z][a-z0-9.-]{5,79}$/;
const WRITES=new Set(['branch.create','source.patch','pr.create',
  'pr.squash','deploy.reversible']);
const TYPES=new Set([...WRITES,'ci.verify','runtime.verify']);
const RELEASE=new Set(['pr.squash','deploy.reversible']);
const CHECKS=['authenticatedOwner','capabilityBound','operationAllowed',
  'profileActive','durableStopAvailable'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refused=reason=>Object.freeze({status:'held',reason,productionAccepted:false});
function plain(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-deep-task');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const out=Object.create(null);
 for(const [key,desc] of Object.entries(descriptors)){
  if(!desc.enumerable||!Object.hasOwn(desc,'value'))
   throw Error('invalid-deep-task');
  out[key]=desc.value;
 }
 return out;
}
function immutableSteps(raw){
 if(!Array.isArray(raw)||raw.length<2||raw.length>12)
  throw Error('invalid-deep-task-steps');
 const result=[],seen=new Set();
 for(const rawStep of raw){
  const step=plain(rawStep),keys=Object.keys(step).sort().join(',');
  if(keys!=='dependsOn,id,type'||!ID.test(step.id||'')||
    !TYPES.has(step.type)||seen.has(step.id)||!Array.isArray(step.dependsOn)||
    step.dependsOn.length>8)
   throw Error('invalid-deep-task-step');
  const deps=[];
  for(const id of step.dependsOn){
   if(typeof id!=='string'||!seen.has(id)||deps.includes(id))
    throw Error('invalid-deep-task-dependency');
   deps.push(id);
  }
  seen.add(step.id);
  result.push(Object.freeze({id:step.id,type:step.type,
   dependsOn:Object.freeze(deps)}));
 }
 if(result.at(-1).type!=='runtime.verify')
  throw Error('deep-task-must-end-in-runtime-verification');
 return Object.freeze(result);
}
export function createDeepTaskPlan(raw){
 const x=plain(raw);
 if(Object.keys(x).sort().join(',')!=='objectiveId,owner,repository,sourceSha,steps'||
    x.owner!==OWNER||x.repository!==REPO||
    !ID.test(x.objectiveId||'')||!SHA.test(x.sourceSha||''))
  throw Error('invalid-deep-task-plan');
 const steps=immutableSteps(x.steps);
 const immutable={schema:'ultron.deep-task.v1',
  owner:OWNER,repository:REPO,objectiveId:x.objectiveId,
  sourceSha:x.sourceSha,steps};
 return Object.freeze({...immutable,digest:digest(immutable)});
}
function checkGate(plan,step,ctx){
 if(!ctx||typeof ctx!=='object')return 'authority-unavailable';
 if(ctx.owner!==plan.owner||ctx.repository!==plan.repository||
    ctx.sourceSha!==plan.sourceSha)return 'authority-source-mismatch';
 if(ctx.paused!==false||ctx.revoked!==false||
    ctx.maxPaidCents!==0)return 'authority-stopped-or-cost';
 if(!Number.isSafeInteger(ctx.profileVersion)||ctx.profileVersion<1||
    !Number.isSafeInteger(ctx.stopVersion)||ctx.stopVersion<1)
   return 'authority-version-missing';
 for(const field of CHECKS)if(ctx[field]!==true)return 'authority-'+field+'-missing';
 if(RELEASE.has(step.type)){
  if(ctx.independentReview!==true||ctx.exactHeadCI!==true||
     ctx.githubMergeable!==true)return 'independent-release-gate-missing';
  if(step.type==='deploy.reversible'&&ctx.rollbackVerified!==true)
   return 'rollback-gate-missing';
 }
 return null;
}
function authenticObservation(plan,step,observed){
 return observed?.verified===true&&
  observed.owner===plan.owner&&observed.repository===plan.repository&&
  observed.sourceSha===plan.sourceSha&&
  observed.objectiveId===plan.objectiveId&&observed.stepId===step.id&&
  observed.operation===step.type&&
  typeof observed.receiptId==='string'&&
  /^[a-z0-9_.:-]{8,128}$/.test(observed.receiptId)&&
  typeof observed.readbackDigest==='string'&&
  /^[a-f0-9]{64}$/.test(observed.readbackDigest);
}
/**
 * One bounded, resumable cycle. Every WRITE must have a durable reservation
 * before its single dispatch. An unknown result is reconciled by observation,
 * NEVER blindly retried. Read-only verification steps use observe only.
 *
 * ledger/readAuthority/bridge must come from real independently authenticated
 * runtime connectors. Calling this with a mock proves logic, not live access.
 */
export async function runDeepTask({plan,ledger,readAuthority,bridge,
  maxSteps=8}={}){
 if(plan?.schema!=='ultron.deep-task.v1'||!SHA.test(plan.sourceSha||'')||
    plan.digest!==digest({schema:plan.schema,owner:plan.owner,
      repository:plan.repository,objectiveId:plan.objectiveId,
      sourceSha:plan.sourceSha,steps:plan.steps})||
    typeof ledger?.read!=='function'||typeof ledger?.reserve!=='function'||
    typeof ledger?.complete!=='function'||typeof readAuthority!=='function'||
    typeof bridge?.observe!=='function'||typeof bridge?.perform!=='function'||
    !Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>8)
  throw Error('deep-task-executor-not-admitted');
 let done=0,dispatched=0;
 for(const step of plan.steps){
  const key='deep:'+plan.digest+':'+step.id;
  let state=await ledger.read(key);
  if(state&&state.digest!==plan.digest)
   return refused('idempotency-fingerprint-conflict');
  if(state?.phase==='verified'){
   // A historic status alone is not independently verified completion.
   // Re-observe the actual external effect and compare immutable evidence.
   let current;
   try{current=await bridge.observe({plan,step,key});}
   catch{return Object.freeze({status:'reconcile-required',
    reason:'verified-step-readback-unavailable',stepId:step.id,
    completed:done,dispatched,productionAccepted:false});}
   if(!authenticObservation(plan,step,current))
    return Object.freeze({status:'reconcile-required',
     reason:'verified-step-postcondition-unavailable',stepId:step.id,
     completed:done,dispatched,productionAccepted:false});
   if(state.receiptId!==current.receiptId||
      state.readbackDigest!==current.readbackDigest)
    return refused('verified-receipt-conflict');
   done++;continue;
  }
  if(done>=maxSteps)return Object.freeze({status:'partial',
   completed:done,dispatched,remaining:plan.steps.length-done,
   productionAccepted:false});
  for(const dep of step.dependsOn){
   const previous=await ledger.read('deep:'+plan.digest+':'+dep);
   if(previous?.phase!=='verified'||previous.digest!==plan.digest)
    return refused('dependency-not-verified');
  }
  const write=WRITES.has(step.type);
  if(state&&state.phase!=='dispatching'&&state.phase!=='reserved')
   return refused('unknown-ledger-state');
  if(!state){
   const authority=await readAuthority({plan,step});
   const denied=checkGate(plan,step,authority);
   if(denied)return refused(denied);
   if(write){
    const claim=await ledger.reserve({key,digest:plan.digest,
      operation:step.type,objectiveId:plan.objectiveId});
    if(claim?.phase!=='dispatching'||claim.digest!==plan.digest)
     return refused('durable-write-reservation-unavailable');
    state=claim;
    try{await bridge.perform({plan,step,key});dispatched++;}
    catch{/* Unknown outcome: observe only, never repeat the write. */}
   }else{
    state={phase:'reserved',digest:plan.digest};
   }
  }
  let observed;
  try{observed=await bridge.observe({plan,step,key});}
  catch{return Object.freeze({status:'reconcile-required',
   reason:'external-readback-unavailable',stepId:step.id,
   completed:done,dispatched,productionAccepted:false});}
  if(!authenticObservation(plan,step,observed)){
   return Object.freeze({status:'reconcile-required',
    reason:'external-postcondition-unverified',stepId:step.id,
    completed:done,dispatched,productionAccepted:false});
  }
  let ack;
  try{ack=await ledger.complete({key,digest:plan.digest,
    receiptId:observed.receiptId,readbackDigest:observed.readbackDigest});}
  catch{return Object.freeze({status:'reconcile-required',
   reason:'completion-write-uncertain',stepId:step.id,
   completed:done,dispatched,productionAccepted:false});}
  if(ack?.phase!=='verified'||ack.digest!==plan.digest||
    ack.receiptId!==observed.receiptId)
   return refused('completion-readback-mismatch');
  done++;
 }
 return Object.freeze({status:'verified-plan',
  completed:done,dispatched,remaining:0,
  productionAccepted:false,
  note:'Every step observed by the adapter; external production acceptance requires independent runtime confirmation.'});
}
