import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findProtectedIssueClosures, inspectPullRequestClosureClaims} from '../scripts/check-protected-issue-closures.mjs';

test('detects GitHub issue closing keywords even when negated in prose',()=>{
 for(const body of [
  'Fixes #65',
  'This does not close #65 — consent is missing',
  'resolves #66',
  'CLOSED michaeljwilliams0123/Ultron.MW#67',
  'fix: #68',
  'Close #65, #66'
 ]){
  assert.ok(findProtectedIssueClosures(body).length>0, body);
 }
});

test('accepts cross-references and explicit non-closing descriptions',()=>{
 for(const body of [
  'Refs #65 and #66; tests pending.',
  'No acceptance for #65.',
  'Remaining work in #68.',
  'Fixes #650',
  'Fixes #19',
  'Fixes unrelated/repository#65'
 ])assert.deepEqual(findProtectedIssueClosures(body),[],body);
});

test('inspects PR title, body and new commit messages',()=>{
 const result=inspectPullRequestClosureClaims({
  title:'Docs: update #65',
  body:'Refs #65, does not resolve #67',
  commitMessages:['feat: add checks','Fixes #66']
 });
 assert.deepEqual(result.map(x=>x.issue),[67,66]);
 assert.deepEqual(result.map(x=>x.source),['pr-body','commit-message']);
});

test('identifies implicit additional IDs in a closing-keyword list',()=>{
 assert.deepEqual(findProtectedIssueClosures('Close #65, #66 and #67').map(x=>x.issue),[65,66,67]);
});

test('rechecks PR body edits before a protected squash merge',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
 assert.match(workflow,/pull_request:\s*\n\s*types:\s*\[[^\]]*\bedited\b[^\]]*\]/);
});
