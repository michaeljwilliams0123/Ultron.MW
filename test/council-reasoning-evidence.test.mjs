import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCouncilReasoningInput,checkExternalInput} from '../src/council-reasoning.mjs';

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
