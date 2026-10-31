import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMutation } from '../src/mutation-evolution.mjs';
import { OuterLoopSession, normalizeExecutionPlan } from '../src/outer-loop.mjs';
import { WORKBENCH_VERBS, workbenchCatalog, runWorkbenchOp } from '../src/owner-workbench.mjs';
import { validateBuildIntent, generateIntegrationFiles } from '../src/framework-builder.mjs';
import { createCapabilityBroker } from '../src/capability-bindings.mjs';

const observed=(id,passed=true)=>({id,passed,evidenceId:'exact-head-test:'+id});

test('an unchanged working customization is preserved, not automatically debt',()=>{
 const baseline=[observed('owner.workbench'),observed('outer.loop')];
 const result=classifyMutation({baseline,candidate:[...baseline]});
 assert.equal(result.classification,'PRESERVED');
 assert.deepEqual(result.preserved,['outer.loop','owner.workbench']);
 assert.deepEqual(result.regressed,[]);
 assert.equal(result.releaseEligible,false);
});

test('a new verified behavior that preserves previous behavior is advancement',()=>{
 const baseline=[observed('owner.workbench'),observed('outer.loop')];
 const result=classifyMutation({
  baseline,candidate:[...baseline,observed('council.research.adapter')]
 });
 assert.equal(result.classification,'ADVANCEMENT');
 assert.deepEqual(result.added,['council.research.adapter']);
 assert.deepEqual(result.regressed,[]);
 assert.equal(result.releaseEligible,false);
});

test('removing a working capability is regression even if a new feature is added',()=>{
 const result=classifyMutation({
  baseline:[observed('owner.workbench'),observed('outer.loop')],
  candidate:[observed('owner.workbench'),observed('new.gpu.adapter')]
 });
 assert.equal(result.classification,'REGRESSION');
 assert.deepEqual(result.regressed,['outer.loop']);
 assert.deepEqual(result.added,['new.gpu.adapter']);
 assert.equal(result.releaseEligible,false);
});

test('a failing existing capability cannot be traded for a new working feature',()=>{
 const result=classifyMutation({
  baseline:[observed('owner.workbench'),observed('outer.loop')],
  candidate:[observed('owner.workbench',false),observed('outer.loop'),observed('new.adapter')]
 });
 assert.equal(result.classification,'REGRESSION');
 assert.deepEqual(result.regressed,['owner.workbench']);
});

test('a non-executed case does not establish advancement or release readiness',()=>{
 const result=classifyMutation({
  baseline:[observed('owner.workbench')],
  candidate:[observed('owner.workbench'),{id:'new.adapter',passed:true}]
 });
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.deepEqual(result.unverified,['new.adapter']);
 assert.equal(result.releaseEligible,false);
});

test('a claim of duplicate cases or malformed receipts is rejected',()=>{
 assert.throws(()=>classifyMutation({
  baseline:[observed('owner.workbench')],
  candidate:[observed('owner.workbench'),observed('owner.workbench')]
 }),/duplicate/i);
 assert.throws(()=>classifyMutation({
  baseline:[observed('owner.workbench')],
  candidate:[{id:'owner.workbench',passed:'yes',evidenceId:'test'}]
 }),/invalid/i);
});

test('existing working customization points are still present and usable',()=>{
 const loop=new OuterLoopSession({sessionId:'mutation-preservation-smoke'});
 assert.equal(loop.sessionId,'mutation-preservation-smoke');
 assert.equal(normalizeExecutionPlan({
  summary:'preserve',steps:[{action:'github.issue.read',args:{number:1}}]
 }).ok,true);
 const catalog=workbenchCatalog();
 assert.ok(WORKBENCH_VERBS.includes('github.actions.dispatch'));
 assert.ok(catalog.verbs.includes('internet.fetch'));
 assert.equal(typeof runWorkbenchOp,'function');
 assert.equal(validateBuildIntent({kind:'api',slug:'custom-growth'}).kind,'api');
 assert.equal(validateBuildIntent({kind:'mcp',slug:'custom-growth'}).kind,'mcp');
 assert.equal(typeof generateIntegrationFiles,'function');
 assert.equal(typeof createCapabilityBroker,'function');
});
