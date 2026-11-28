import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentDocs,validateAgentDocs} from '../scripts/build-agent-docs.mjs';

test('curated documents are the only accepted bytes, not merely safe-looking URLs',()=>{
  const docs=buildAgentDocs();
  assert.equal(validateAgentDocs(docs),true);
  for(const suffix of [
    '\n[private](/release-owner.html)',
    '\n[private](//example.invalid/private)',
    '\n[private](../workspace.html)',
    '\n<a href="javascript:alert(1)">bad</a>',
    '\n<script>alert(1)</script>',
    '\nUnreviewed operational instructions.',
  ]){
    assert.throws(()=>validateAgentDocs({...docs,'llms.txt':docs['llms.txt']+suffix}),/unapproved-document-content|private-material|non-allowlisted-link/);
  }
});
test('every approved asset must contain the exact generated content',()=>{
  const docs=buildAgentDocs();
  for(const path of Object.keys(docs)){
    assert.throws(()=>validateAgentDocs({...docs,[path]:''}),/unapproved-document-content/);
  }
});
