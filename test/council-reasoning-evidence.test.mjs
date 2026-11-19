import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCouncilReasoningInput,checkExternalInput} from '../src/council-reasoning.mjs';
import {buildCouncilPrContext} from '../src/council-pr-context.mjs';

const SHA='a'.repeat(40);
const evidence={
 schema:'ultron.council-exact-head-evidence.v1',
 verified:true,reason:null,sourceSha:SHA,prNumber:454,
 repositoryId:1424939667,providerAppId:15368,
 checks:['test','fixed-comparison','attested-receipt'],
 baseUpToDate:true,releaseAuthorized:false,
 credential:'DO-NOT-FORWARD-ARBITRARY-FIELDS'
};
const inputFor=(reviewEvidence)=>buildCouncilReasoningInput({
 title:'Fix Council evidence',body:'Verify all tests before release',
 sourceSha:SHA,prNumber:454,reviewEvidence
});

test('verified provider readback is visible to model reviewers as evidence, never release authority',()=>{
 const input=inputFor(evidence);
 assert.match(input,/Trusted GitHub exact-head CI: VERIFIED/);
 assert.match(input,/PR #454/);
 assert.match(input,/test, fixed-comparison, attested-receipt/);
 assert.match(input,/Release authorization: NOT ESTABLISHED/);
 assert.doesNotMatch(input,/DO-NOT-FORWARD-ARBITRARY-FIELDS/);
 assert.equal(checkExternalInput(input).ok,true);
});

test('unverified, foreign or mismatched evidence cannot be laundered into passing CI claims',()=>{
 const cases=[
  null,
  {...evidence,verified:false},
  {...evidence,sourceSha:'b'.repeat(40)},
  {...evidence,prNumber:453},
  {...evidence,repositoryId:1},
  {...evidence,providerAppId:5765239},
  {...evidence,baseUpToDate:false},
  {...evidence,releaseAuthorized:true},
  {...evidence,checks:['test','fixed-comparison']},
  {...evidence,checks:['test','fixed-comparison','attested-receipt','custom']}
 ];
 for(const item of cases){
  const input=inputFor(item);
  assert.doesNotMatch(input,/Trusted GitHub exact-head CI: VERIFIED/);
  assert.match(input,/Release authorization: NOT ESTABLISHED/);
 }
});

test('trusted main Council review actually forwards the provider-derived evidence summary',()=>{
 const script=readFileSync(new URL('../scripts/council-debate.mjs',import.meta.url),'utf8');
 assert.match(script,/runReasoningRound\(\{\s*input:\s*buildCouncilReasoningInput\(/);
});

test('model input contains bounded exact-head diff and ignores foreign-head patch data',()=>{
 const prContext=buildCouncilPrContext({sourceSha:SHA,prNumber:454,
  files:[{filename:'src/provider.js',status:'modified',additions:1,deletions:0,
   patch:'@@ -1 +1 @@\\n+ const result = safePermissionSignal(headers);'}]});
 const input=buildCouncilReasoningInput({title:'Inspect the provider changes',
  body:'Verify the new guard',sourceSha:SHA,prNumber:454,
  reviewEvidence:evidence,prContext});
 assert.equal(input.includes('src/provider.js'),true);
 assert.match(input,/safePermissionSignal/);
 assert.equal(checkExternalInput(input).ok,true);
 const foreign=buildCouncilReasoningInput({title:'Inspect',
  body:'Verify',sourceSha:'b'.repeat(40),prNumber:454,prContext});
 assert.doesNotMatch(foreign,/safePermissionSignal/);
 assert.match(foreign,/patch evidence unavailable/);
});

test('AST taint evidence reaches model only for exact source SHA and is never a release approval',async()=>{
 const {scanCouncilChangedFiles}=await import('../src/council-taint-evidence.mjs');
 const taintEvidence=scanCouncilChangedFiles({sourceSha:SHA,prNumber:454,sources:[{
  filename:'src/handler.mjs',
  source:"import {exec} from 'node:child_process';\nexec(req.body.cmd);"
 }]});
 const input=buildCouncilReasoningInput({title:'Check command handling',body:'Verify the source',
  sourceSha:SHA,prNumber:454,taintEvidence});
 assert.match(input,/AST taint scan/);
 assert.match(input,/sink exec/);
 assert.match(input,/Release authorization: NOT ESTABLISHED/);
 const foreign=buildCouncilReasoningInput({title:'Check command handling',
  body:'Verify',sourceSha:'b'.repeat(40),prNumber:454,taintEvidence});
 assert.doesNotMatch(foreign,/sink exec/);
});


test('model budget marks an omitted suffix rather than manufacturing source EOF',()=>{
 const excerpt=Array.from({length:80},(_,i)=>'| + const k'+String(i).padStart(2,'0')+' = 123456;').join('\n');
 const context={
  schema:'ultron.council-pr-context.v1',sourceSha:SHA,prNumber:454,
  filesObserved:2,filesRendered:2,redactedFiles:0,complete:false,
  maxTextChars:5000,
  files:[
   {path:'src/first.mjs',tag:'source',additions:80,deletions:0,excerpt},
   {path:'src/second.mjs',tag:'source',additions:80,deletions:0,excerpt}
  ]
 };
 const input=buildCouncilReasoningInput({
  title:'R'.repeat(240),body:'D'.repeat(650),sourceSha:SHA,prNumber:454,
  prContext:context
 });
 assert.match(input,/model excerpt truncated by input budget; not source EOF/);
 assert.match(input,/Release authorization: NOT ESTABLISHED/);
 assert.ok(input.length<=5990);
 assert.equal(checkExternalInput(input).ok,true);
});
