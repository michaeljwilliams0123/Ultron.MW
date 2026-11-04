import test from 'node:test';
import assert from 'node:assert/strict';
import {findProtectedIssueClosures,inspectPullRequestClosureClaims}
 from '../scripts/check-protected-issue-closures.mjs';

test('GH-CLOSE-01: a negated closing keyword must still block issue #245',()=>{
 assert.deepEqual(findProtectedIssueClosures('This does **not** close #245.'),
  [{issue:245}]);
 assert.deepEqual(findProtectedIssueClosures('Do not close #245 until production accepted.'),
  [{issue:245}]);
});

test('GH-CLOSE-02: modern Continuum acceptance gates are protected',()=>{
 const expected=[173,182,188,193,195,204,245,248];
 for(const number of expected){
  for(const keyword of ['Closes','Fixes','Resolves']){
   assert.deepEqual(findProtectedIssueClosures(keyword+' #'+number),
    [{issue:number}],keyword+' #'+number);
  }
 }
 for(const number of [65,66,67,68])
  assert.deepEqual(findProtectedIssueClosures('Closes #'+number),[{issue:number}]);
});

test('GH-CLOSE-03: chained negated issue claims identify each protected acceptance gate',()=>{
 const claims=inspectPullRequestClosureClaims({
  title:'Release is not complete',
  body:'This does not close #245, #204 and #193; they still need production evidence.',
  commitMessages:['fixes #188 in notes only']
 });
 assert.deepEqual(claims,[
  {issue:245,source:'pr-body'},
  {issue:204,source:'pr-body'},
  {issue:193,source:'pr-body'},
  {issue:188,source:'commit-message'}
 ]);
});

test('GH-CLOSE-04: nonclosing links and completed bounded evaluation issue remain allowed',()=>{
 for(const phrase of ['Refs #245','Advances #245','See #204',
  'Closes #249','Fixes #249','Docs for #245'])
  assert.deepEqual(findProtectedIssueClosures(phrase),[],phrase);
});

test('GH-CLOSE-05: scanner reports source for title, body, and commit',()=>{
 const claims=inspectPullRequestClosureClaims({
  title:'Resolves #173',body:'It does not close #245.',
  commitMessages:['Closes #195','Refs #193']
 });
 assert.deepEqual(claims,[
  {issue:173,source:'pr-title'},
  {issue:245,source:'pr-body'},
  {issue:195,source:'commit-message'}
 ]);
});
