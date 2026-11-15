import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCouncilPrContext,formatCouncilPrContext} from '../src/council-pr-context.mjs';

const sha='a'.repeat(40);
const file=(filename,patch,other={})=>({filename,status:'modified',patch,additions:1,deletions:1,...other});

test('exact-head patch context names files and real changed lines without invented vulnerabilities',()=>{
 const context=buildCouncilPrContext({sourceSha:sha,prNumber:459,files:[
  file('lib/github-pr-comment-canary.js','@@ -21,2 +21,3 @@\n- return failure;\n+ return safePermissionSignal(headers);'),
  file('test/c04-provider-403-ux.test.mjs','@@ -8,2 +8,3 @@\n+ assert.equal(hint, expected);')
 ]});
 assert.equal(context.sourceSha,sha);
 assert.equal(context.prNumber,459);
 assert.equal(context.filesObserved,2);
 assert.equal(context.complete,true);
 const out=formatCouncilPrContext(context);
 assert.match(out,/github-pr-comment-canary/);
 assert.match(out,/safePermissionSignal/);
 assert.match(out,/c04-provider-403-ux.test/);
 assert.doesNotMatch(out,/vulnerability detected|approved by independent reviewer/i);
});

test('secret-bearing diff does not leave patch context and only a bounded redaction marker remains',()=>{
 const patch='@@ -1 +1 @@\n+ const token = "ghp_'+'z'.repeat(30)+'";';
 const context=buildCouncilPrContext({sourceSha:sha,prNumber:2,files:[file('src/auth.js',patch)]});
 const out=formatCouncilPrContext(context);
 assert.match(out,/redacted/i);
 assert.doesNotMatch(out,/ghp_z/);
 assert.equal(context.redactedFiles,1);
});

test('untrusted oversized patches and path manipulation are capped or excluded',()=>{
 const files=Array.from({length:30},(_,i)=>file('src/module'+i+'.js','@@ -1 +1 @@\n+'+'x'.repeat(3000)));
 files.push(file('../SECRET.txt','@@ -1 +1 @@\n+bad'));
 const ctx=buildCouncilPrContext({sourceSha:sha,prNumber:42,files,maxFiles:12,maxTextChars:3000});
 const rendered=formatCouncilPrContext(ctx);
 assert.ok(rendered.length<=3300);
 assert.equal(ctx.complete,false);
 assert.doesNotMatch(rendered,/SECRET.txt/);
 assert.ok(ctx.filesObserved===31);
});

test('bad head or invalid file list never becomes accepted exact-head analysis',()=>{
 assert.throws(()=>buildCouncilPrContext({sourceSha:'not-sha',prNumber:1,files:[]}),/source-sha-invalid/);
 assert.throws(()=>buildCouncilPrContext({sourceSha:sha,prNumber:1,files:null}),/file-list-unavailable/);
 const context=buildCouncilPrContext({sourceSha:sha,prNumber:1,files:[],complete:false});
 assert.equal(context.complete,false);
});
