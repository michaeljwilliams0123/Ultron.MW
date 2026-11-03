import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDeepTaskPlan,runDeepTask} from '../src/deep-task.mjs';

const REPO='michaeljwilliams0123/Ultron.MW',OWNER='michaeljwilliams0123';
const SHA='a'.repeat(40);
const steps=[
 {id:'branch-created',type:'branch.create',dependsOn:[]},
 {id:'source-patched',type:'source.patch',dependsOn:['branch-created']},
 {id:'pr-opened',type:'pr.create',dependsOn:['source-patched']},
 {id:'ci-confirmed',type:'ci.verify',dependsOn:['pr-opened']},
 {id:'pr-merged',type:'pr.squash',dependsOn:['ci-confirmed']},
 {id:'runtime-confirmed',type:'runtime.verify',dependsOn:['pr-merged']}
];
const plan=()=>createDeepTaskPlan({owner:OWNER,repository:REPO,
 objectiveId:'deep-task-canary-01',sourceSha:SHA,steps});
const hash=s=>createHash('sha256').update(s).digest('hex');
function harness({uncertainAt=null,missingAt=null,deny=null}={}){
 const state=new Map(),effects=new Set(),performed=[],observations=[];
 const ctx={owner:OWNER,repository:REPO,sourceSha:SHA,
  paused:false,revoked:false,maxPaidCents:0,profileVersion:4,stopVersion:3,
  authenticatedOwner:true,capabilityBound:true,operationAllowed:true,
  profileActive:true,durableStopAvailable:true,
  exactHeadCI:true,githubMergeable:true,rollbackVerified:true};
 const ledger={
  async read(key){return state.get(key)||null;},
  async reserve({key,digest,operation}){
   if(state.has(key))throw Error('duplicate-reservation');
   const row={phase:'dispatching',digest,operation};
   state.set(key,row);return row;
  },
  async complete({key,digest,receiptId,readbackDigest}){
   const row=state.get(key);
   if(row&&row.digest!==digest)throw Error('conflict');
   const next={...row,phase:'verified',digest,receiptId,readbackDigest};
   state.set(key,next);return next;
  }
 };
 const bridge={
  async perform({step}){
   performed.push(step.id);effects.add(step.id);
   if(step.id===uncertainAt)throw Error('lost acknowledgment after write');
  },
  async observe({plan,step}){
   observations.push(step.id);
   if(step.id===missingAt)return null;
   if(!effects.has(step.id)&&['branch.create','source.patch','pr.create','pr.squash','deploy.reversible'].includes(step.type))
    return null;
   return {verified:true,owner:OWNER,repository:REPO,
    objectiveId:plan.objectiveId,sourceSha:SHA,stepId:step.id,
    operation:step.type,receiptId:'github-receipt:'+step.id,
    readbackDigest:hash(step.id)};
  }
 };
 return {ledger,bridge,state,effects,performed,observations,
  async readAuthority(){return {...ctx,...(deny||{})}}};
}
test('Deep task creates branch, patch and PR, verifies CI/review and source merge, then confirms runtime',async()=>{
 const h=harness();
 const result=await runDeepTask({plan:plan(),...h});
 assert.equal(result.status,'verified-plan');
 assert.equal(result.completed,6);
 assert.equal(result.dispatched,4);
 assert.equal(result.productionAccepted,false);
 assert.deepEqual(h.performed,['branch-created','source-patched','pr-opened','pr-merged']);
 assert.equal(h.state.size,6);
});
test('each turn is bounded to a maximum eight steps and safely resumes',async()=>{
 const h=harness(),p=plan();
 const first=await runDeepTask({plan:p,...h,maxSteps:2});
 assert.equal(first.status,'partial');assert.equal(first.completed,2);
 const second=await runDeepTask({plan:p,...h,maxSteps:8});
 assert.equal(second.status,'verified-plan');
 assert.equal(h.performed.length,4,'no duplicate external writes');
 const third=await runDeepTask({plan:p,...h,maxSteps:8});
 assert.equal(third.dispatched,0);
});
test('lost acknowledgment reconciles the original effect without a second write',async()=>{
 const h=harness({uncertainAt:'source-patched'});
 const r=await runDeepTask({plan:plan(),...h});
 assert.equal(r.status,'verified-plan');
 assert.equal(h.performed.filter(x=>x==='source-patched').length,1);
});
test('unverified external postcondition holds; resumption observes without redispatch',async()=>{
 const h=harness({missingAt:'source-patched'}),p=plan();
 const r=await runDeepTask({plan:p,...h});
 assert.equal(r.status,'reconcile-required');
 assert.equal(r.stepId,'source-patched');
 assert.equal(h.performed.filter(x=>x==='source-patched').length,1);
 h.bridge.observe=async({plan,step})=>({verified:true,owner:OWNER,
  repository:REPO,objectiveId:plan.objectiveId,sourceSha:SHA,stepId:step.id,
  operation:step.type,receiptId:'github-receipt:'+step.id,
  readbackDigest:hash(step.id)});
 const second=await runDeepTask({plan:p,...h});
 assert.equal(second.status,'verified-plan');
 assert.equal(h.performed.filter(x=>x==='source-patched').length,1);
});
test('release requires exact-head CI and real mergeability without a reviewer',async()=>{
 for(const denied of [{exactHeadCI:false},{githubMergeable:false}]){
  const h=harness({deny:denied});
  const r=await runDeepTask({plan:plan(),...h});
  assert.equal(r.status,'held');
  assert.equal(r.reason,'release-verification-gate-missing');
  assert.ok(!h.performed.includes('pr-merged'));
 }
});
test('owner pause, missing real capability, paid usage and source changes prevent writes',async()=>{
 for(const denied of [{paused:true},{revoked:true},{maxPaidCents:1},
  {authenticatedOwner:false},{capabilityBound:false},{sourceSha:'f'.repeat(40)}]){
  const h=harness({deny:denied});
  const r=await runDeepTask({plan:plan(),...h});
  assert.equal(r.status,'held');
  assert.equal(h.performed.length,0);
 }
});
test('bad plan paths and ordering cannot gain authority',()=>{
 for(const wrong of [
  {steps:[...steps.slice(0,-1),{id:'runtime-confirmed',type:'admin.modify',dependsOn:[]}]},
  {steps:[{...steps[0],dependsOn:['pr-merged']},...steps.slice(1)]},
  {steps:[...steps.slice(0,-1),{...steps.at(-1),type:'deploy.reversible'}]},
  {steps:[...steps.slice(0,-1),{...steps.at(-1),id:'source-patched'}]},
  {owner:'another-user'}, {repository:'another/repo'}, {sourceSha:'changed'}
 ]){
  assert.throws(()=>createDeepTaskPlan({owner:OWNER,repository:REPO,
   objectiveId:'deep-task-canary-01',sourceSha:SHA,steps,...wrong}),/deep-task/);
 }
});
test('untrusted cloned plan cannot rewrite immutable digest or bypass authorization',async()=>{
 const p=plan(),h=harness();
 const mutable={...p,sourceSha:'f'.repeat(40)};
 await assert.rejects(runDeepTask({plan:mutable,...h}),/not-admitted/);
 const bad={...p,steps:[...p.steps,{id:'credential-created',type:'credential.create',dependsOn:[]}]};
 await assert.rejects(runDeepTask({plan:bad,...h}),/not-admitted/);
 assert.equal(h.performed.length,0);
});
test('complete is a verified plan, never a fabricated production acceptance',async()=>{
 const r=await runDeepTask({plan:plan(),...harness()});
 assert.equal(r.status,'verified-plan');
 assert.equal(r.productionAccepted,false);
});

test('already-verified steps demand fresh authentic readback before resumption',async()=>{
 const h=harness(),p=plan();
 assert.equal((await runDeepTask({plan:p,...h})).status,'verified-plan');
 const calls=h.performed.length;
 const original=h.bridge.observe;
 h.bridge.observe=async({plan,step,key})=>
  step.id==='branch-created'?null:original({plan,step,key});
 const stale=await runDeepTask({plan:p,...h});
 assert.equal(stale.status,'reconcile-required');
 assert.equal(stale.stepId,'branch-created');
 assert.equal(h.performed.length,calls,'repeated verification must never replay writes');
});
test('changed receipt identity on a completed step is a ledger conflict, not proof',async()=>{
 const h=harness(),p=plan();
 await runDeepTask({plan:p,...h});
 h.bridge.observe=async({plan,step})=>({
  verified:true,owner:OWNER,repository:REPO,objectiveId:plan.objectiveId,
  sourceSha:SHA,stepId:step.id,operation:step.type,
  receiptId:'github-receipt:forged',readbackDigest:hash(step.id)
 });
 const mismatch=await runDeepTask({plan:p,...h});
 assert.equal(mismatch.status,'held');
 assert.equal(mismatch.reason,'verified-receipt-conflict');
});
