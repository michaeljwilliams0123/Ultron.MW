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

test('bounded patch review keeps a late relevant source change and release caveat',async()=>{
 const {buildCouncilPrContext,formatCouncilPrContext}=await import('../src/council-pr-context.mjs');
 const {buildCouncilReasoningInput}=await import('../src/council-reasoning.mjs');
 const lines=['@@ -1,27 +1,27 @@',
  ...Array.from({length:24},(_,i)=>'+ const phase'+i+' = '+i+';'),
  '+ const terminalDeniedNoEffect = durableReadbackConfirmed;',
  '- return reconcile_required;'];
 const context=buildCouncilPrContext({sourceSha:'a'.repeat(40),prNumber:479,
  files:[{filename:'cloud/hatchable/lib/github-pr-comment-canary.js',
   status:'modified',additions:26,deletions:1,patch:lines.join('\n')},
   {filename:'test/c04-terminal-reconciliation.test.mjs',status:'modified',
   additions:2,deletions:1,patch:'@@ -1 +1 @@\n- assert.fail();\n+ assert.equal(state,"denied_no_effect");'}]});
 const patch=formatCouncilPrContext(context);
 assert.match(patch,/terminalDeniedNoEffect = durableReadbackConfirmed/);
 const prompt=buildCouncilReasoningInput({title:'Prove C04 reconciliation',
  body:'description '.repeat(200),sourceSha:'a'.repeat(40),prNumber:479,
  prContext:context});
 assert.match(prompt,/terminalDeniedNoEffect = durableReadbackConfirmed/);
 assert.match(prompt,/Release authorization: NOT ESTABLISHED/);
 assert.ok(prompt.length<=5990);
 assert.doesNotMatch(prompt,/ghp_[A-Za-z0-9]{15,}/);
});
test('long patch beyond bounded limit remains explicitly partial',()=>{
 const lines=['@@ -1,100 +1,100 @@',...Array.from({length:100},(_,i)=>'+ const x'+i+' = '+i+';')];
 const ctx=buildCouncilPrContext({sourceSha:sha,prNumber:479,
  files:[file('src/safe.mjs',lines.join('\n'))]});
 assert.equal(ctx.complete,false);
 assert.match(formatCouncilPrContext(ctx),/partial\/unverified/);
});

test('source-heavy C04 SQL excerpt reaches its terminal and readback guards',()=>{
 const lines=['@@ -329,1 +329,52 @@',
  ...Array.from({length:39},(_,i)=>'+ const validatedColumn'+i+' = "durable-'+i+'";'),
  '+ const completeAuthenticatedReadback = true;',
  '+ const terminalDenialRequiresStored403 = true;'];
 const ctx=buildCouncilPrContext({sourceSha:sha,prNumber:479,
  files:[file('cloud/hatchable/lib/github-pr-comment-canary.js',lines.join('\n'))]});
 const excerpt=formatCouncilPrContext(ctx);
 assert.match(excerpt,/completeAuthenticatedReadback/);
 assert.match(excerpt,/terminalDenialRequiresStored403/);
 assert.ok(excerpt.length<=ctx.maxTextChars);
});
