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


test('a repaired formerly failing capability is an advancement rather than invisible preservation',()=>{
 const result=classifyMutation({
  baseline:[observed('council.reason',false),observed('owner.workbench')],
  candidate:[observed('council.reason'),observed('owner.workbench')]
 });
 assert.equal(result.classification,'ADVANCEMENT');
 assert.deepEqual(result.recovered,['council.reason']);
 assert.deepEqual(result.preserved,['owner.workbench']);
 assert.deepEqual(result.regressed,[]);
});

test('a newly introduced failing capability is not counted as preserved or advancement',()=>{
 const result=classifyMutation({
  baseline:[observed('owner.workbench')],
  candidate:[observed('owner.workbench'),observed('new.model.adapter',false)]
 });
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.deepEqual(result.added,[]);
 assert.deepEqual(result.failed,['new.model.adapter']);
 assert.deepEqual(result.preserved,['owner.workbench']);
});

test('an existing known failure is not silently mislabeled as a healthy unchanged system',()=>{
 const result=classifyMutation({
  baseline:[observed('owner.workbench',false)],
  candidate:[observed('owner.workbench',false)]
 });
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.deepEqual(result.failed,['owner.workbench']);
 assert.deepEqual(result.preserved,[]);
 assert.equal(result.releaseEligible,false);
});

test('a previously failing case without a candidate measurement stays inconclusive',()=>{
 const result=classifyMutation({
  baseline:[observed('council.reason',false)],
  candidate:[]
 });
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.deepEqual(result.unverified,['council.reason']);
 assert.equal(result.releaseEligible,false);
});

test('empty case sets cannot prove anything was preserved',()=>{
 const result=classifyMutation({baseline:[],candidate:[]});
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.equal(result.releaseEligible,false);
});

test('regression takes priority over a recovered capability and an added capability',()=>{
 const result=classifyMutation({
  baseline:[
   observed('owner.workbench'),observed('outer.loop'),
   observed('council.reason',false)
  ],
  candidate:[
   observed('owner.workbench',false),observed('outer.loop'),
   observed('council.reason'),observed('new.research.adapter')
  ]
 });
 assert.equal(result.classification,'REGRESSION');
 assert.deepEqual(result.regressed,['owner.workbench']);
 assert.deepEqual(result.recovered,['council.reason']);
 assert.deepEqual(result.added,['new.research.adapter']);
 assert.equal(result.releaseEligible,false);
});

test('a case with missing baseline evidence cannot be called a verified advancement',()=>{
 const result=classifyMutation({
  baseline:[{id:'owner.workbench',passed:true}],
  candidate:[observed('owner.workbench'),observed('new.research.adapter')]
 });
 assert.equal(result.classification,'INCONCLUSIVE');
 assert.deepEqual(result.unverified,['owner.workbench']);
 assert.deepEqual(result.added,['new.research.adapter']);
});

test('input receipts with whitespace and nonstring evidence cannot establish success',()=>{
 for(const evidenceId of ['   ',null,0,{},false]){
  const result=classifyMutation({
   baseline:[observed('owner.workbench')],
   candidate:[observed('owner.workbench'),{id:'new.adapter',passed:true,evidenceId}]
  });
  assert.equal(result.classification,'INCONCLUSIVE');
  assert.deepEqual(result.unverified,['new.adapter']);
 }
});

test('baseline duplicate cases fail closed rather than masking earlier behavior',()=>{
 assert.throws(()=>classifyMutation({
  baseline:[observed('owner.workbench'),observed('owner.workbench',false)],
  candidate:[observed('owner.workbench')]
 }),/duplicate/i);
});

test('nonarrays and malformed case ids fail closed',()=>{
 for(const args of [
  undefined,{baseline:null,candidate:[]},{baseline:[],candidate:{}},
  {baseline:[],candidate:[{id:'__proto__',passed:true,evidenceId:'test'}]},
  {baseline:[],candidate:[{id:'ok.case',passed:1,evidenceId:'test'}]}
 ]){
  assert.throws(()=>classifyMutation(args),/invalid/i);
 }
});

test('classification remains invariant under case ordering and output is immutable',()=>{
 const a=[observed('outer.loop'),observed('owner.workbench'),observed('council.reason',false)];
 const b=[observed('new.adapter'),observed('council.reason'),
  observed('owner.workbench'),observed('outer.loop')];
 const direct=classifyMutation({baseline:a,candidate:b});
 const reversed=classifyMutation({baseline:[...a].reverse(),candidate:[...b].reverse()});
 assert.deepEqual(reversed,direct);
 assert.equal(direct.classification,'ADVANCEMENT');
 assert.ok(Object.isFrozen(direct));
 for(const key of ['preserved','added','recovered','regressed','failed','unverified'])
  assert.ok(Object.isFrozen(direct[key]),key);
 assert.deepEqual(direct.recovered,['council.reason']);
});

test('exhaustive two-feature mutation matrix never calls a lost working feature advancement',()=>{
 const feature=['owner.workbench','outer.loop'];
 const states=[undefined,false,true];
 for(const baseA of [false,true]){
  for(const baseB of [false,true]){
   for(const nextA of states){
    for(const nextB of states){
     const baseline=[observed(feature[0],baseA),observed(feature[1],baseB)];
     const candidate=[nextA===undefined?null:observed(feature[0],nextA),
      nextB===undefined?null:observed(feature[1],nextB)].filter(Boolean);
     const result=classifyMutation({baseline,candidate});
     const hasRegression=(baseA&&!nextA)||(baseB&&!nextB);
     if(hasRegression)assert.equal(result.classification,'REGRESSION',
      JSON.stringify({baseA,baseB,nextA,nextB}));
     assert.equal(result.releaseEligible,false);
    }
   }
  }
 }
});

test('large custom capability sets preserve all features without truncation',()=>{
 const baseline=Array.from({length:256},(_,i)=>observed('custom.feature.'+String(i).padStart(3,'0')));
 const candidate=[...baseline,observed('new.large.adapter')];
 const result=classifyMutation({baseline,candidate});
 assert.equal(result.classification,'ADVANCEMENT');
 assert.equal(result.preserved.length,256);
 assert.deepEqual(result.added,['new.large.adapter']);
 assert.deepEqual(result.regressed,[]);
});
