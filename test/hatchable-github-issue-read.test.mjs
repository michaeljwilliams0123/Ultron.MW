import test from 'node:test';
import assert from 'node:assert/strict';
import {readGithubIssue} from '../cloud/hatchable/lib/github-issue-read.js';

test('issue adapter uses a fixed endpoint, read method and strict projection',async()=>{
 let observed;
 const result=await readGithubIssue(42,{transport:async(url,options)=>{
  observed={url,options};
  return new Response(JSON.stringify({number:42,title:'Issue',state:'open',
   updated_at:'2026-01-01T00:00:00Z',body:'private data not returned'}));
 }});
 assert.equal(observed.url,'https://api.github.com/repos/Ultron-MW/Ultron.MW/issues/42');
 assert.equal(observed.options.method,'GET');
 assert.equal(observed.options.redirect,'error');
 assert.ok(observed.options.signal instanceof AbortSignal);
 assert.deepEqual(result,{ok:true,issue:{number:42,title:'Issue',state:'open',
  updatedAt:'2026-01-01T00:00:00Z'}});
});
test('issue adapter rejects malformed input and provider failures',async()=>{
 let calls=0;
 assert.equal((await readGithubIssue('42',{transport:async()=>{calls++;}})).error,'invalid-issue-number');
 assert.equal(calls,0);
 assert.equal((await readGithubIssue(42,{transport:async()=>new Response('',{status:404})})).error,'github-read-failed');
 assert.equal((await readGithubIssue(42,{transport:async()=>{throw Error('offline');}})).error,'github-read-unavailable');
 assert.equal((await readGithubIssue(42,{transport:async()=>new Response(JSON.stringify(
  {number:42,title:'PR',state:'open',updated_at:'x',pull_request:{}}))})).error,'github-response-invalid');
});
test('issue adapter bounds declared and streamed response size',async()=>{
 assert.equal((await readGithubIssue(42,{transport:async()=>new Response('x',
  {headers:{'content-length':'65537'}})})).error,'github-response-too-large');
 assert.equal((await readGithubIssue(42,{transport:async()=>new Response('x'.repeat(65537))})).error,'github-response-too-large');
});
