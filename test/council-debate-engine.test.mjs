import test from 'node:test';
import assert from 'node:assert/strict';
import {executeCouncilDebateLoop} from '../src/engine/council-debate-engine.mjs';
const SHA='a'.repeat(40);
const taskContext={taskId:'canary-42',sourceSha:SHA,objective:'Review bounded change'};
const good=async({roleId,sourceSha})=>({roleId,sourceSha,position:{
 conclusion:'proceed',confidence:0.9,evidenceRefs:['test:canary-42'],
 assumptions:[],unknowns:[],dissentTags:[]}});
test('without an actual provider executor there are no invented Council turns or approvals',async()=>{
 const r=await executeCouncilDebateLoop(taskContext);
 assert.equal(r.status,'held');assert.equal(r.roleTurns.length,0);
 assert.equal(r.authorized,false);assert.equal(r.githubWritePerformed,false);
});
test('seven real callback results preserve stages, evidence, and advisory-only decision',async()=>{
 const called=[];
 const r=await executeCouncilDebateLoop(taskContext,{runPersona:async args=>{
  called.push({role:args.roleId,phase:args.phase,prior:args.prior.length});
  return good(args);
 }});
 assert.equal(r.status,'advisory-ready');assert.equal(r.decision,'proceed');
 assert.equal(r.roleTurns.length,7);assert.equal(new Set(called.map(x=>x.role)).size,7);
 assert.equal(r.authorized,false);assert.equal(r.githubWritePerformed,false);
 assert.equal(r.verifiedIndependentRoleCount,0);
 assert.ok(called.find(x=>x.role==='ultron-steward').prior>=6);
 assert.ok(called.find(x=>x.role==='ultron-sentinel').prior>=2);
});
test('security dissent halts instead of silently allowing finalization',async()=>{
 const r=await executeCouncilDebateLoop(taskContext,{runPersona:async args=>{
  const x=await good(args);
  if(args.roleId==='ultron-sentinel'){
   x.position.conclusion='hold';x.position.dissentTags=['security-gap'];
  }
  return x;
 }});
 assert.equal(r.decision,'hold');assert.equal(r.status,'held');
 assert.equal(r.authorized,false);
});
test('unknowns and missing evidence cannot be promoted to consensus',async()=>{
 for(const variant of ['no-evidence','unknown']){
  const r=await executeCouncilDebateLoop(taskContext,{runPersona:async args=>{
   const x=await good(args);
   if(args.roleId==='ultron-builder'){
    if(variant==='no-evidence')x.position.evidenceRefs=[];
    else x.position.unknowns=['provider-absent'];
   }
   return x;
  }});
  assert.equal(r.status,'held');assert.equal(r.authorized,false);
 }
});
test('wrong role, stale SHA, unsupported claims and executor error fail closed',async()=>{
 for(const variant of ['wrong','stale','throws']){
  const r=await executeCouncilDebateLoop(taskContext,{runPersona:async args=>{
   if(variant==='throws')throw Error('private-adapter-error-not-for-user');
   const x=await good(args);
   if(variant==='wrong')x.roleId='ultron-attacker';
   if(variant==='stale')x.sourceSha='b'.repeat(40);
   return x;
  }});
  assert.equal(r.status,'held');assert.equal(r.authorized,false);
  assert.equal(JSON.stringify(r).includes('private-adapter-error-not-for-user'),false);
 }
});
test('invalid task IDs and SHAs are rejected before model/provider work',async()=>{
 for(const data of [{...taskContext,taskId:''},{...taskContext,sourceSha:'latest'},
  {...taskContext,objective:'a'.repeat(900)}]){
  await assert.rejects(executeCouncilDebateLoop(data,{runPersona:good}),/council-debate-context-invalid/);
 }
});

test('a stalled role cannot suspend an advisory Council invocation indefinitely',async()=>{
 const r=await executeCouncilDebateLoop(taskContext,{runPersona:()=>new Promise(()=>{}),roleTimeoutMs:20});
 assert.equal(r.status,'held');assert.equal(r.roleTurns.length,0);
 assert.equal(r.reason,'role-execution-or-evidence-unavailable');
});
