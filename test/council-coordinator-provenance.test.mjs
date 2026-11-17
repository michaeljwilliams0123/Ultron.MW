import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCouncilPrContext,formatCouncilPrContext}
 from '../src/council-pr-context.mjs';

const workflow=()=>readFileSync(new URL(
 '../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
const SHA='a'.repeat(40);

test('Coordinator live-review may only use its distinct matching App private key',()=>{
 const y=workflow();
 assert.match(y,/COUNCIL_COORDINATOR_APP_ID:\s*\$\{\{ vars\.ULTRON_GITHUB_APP_ID \}\}/);
 assert.match(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_COORDINATOR_PRIVATE_KEY \}\}/);
 assert.doesNotMatch(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_BUILDER_PRIVATE_KEY \}\}/);
});

test('trusted Council source extraction carries full GitHub patch into bounded redacted context',()=>{
 const y=workflow();
 assert.match(y,/f\.patch\.length<=12000/);
 assert.match(y,/f\.patch\.slice\(0,12000\)/);
 assert.doesNotMatch(y,/f\.patch\.slice\(0,2400\)/);
});

test('bounded source review retains late complete-scan and denial guards instead of front-only truncation',()=>{
 const lines=['@@ -329,1 +329,100 @@',
  '+ const persisted403 = providerWriteDenied === true;',
  ...Array.from({length:75},(_,i)=>'+ const verifiedCondition'+i+' = '+i+';'),
  '+ if(!completeScan) fail("readback-unavailable");',
  '+ if(!persisted403) return null;'];
 const ctx=buildCouncilPrContext({sourceSha:SHA,prNumber:479,
  files:[{filename:'cloud/hatchable/lib/github-pr-comment-canary.js',
   status:'modified',additions:78,deletions:0,patch:lines.join('\n')}]});
 const output=formatCouncilPrContext(ctx);
 assert.match(output,/persisted403 = providerWriteDenied/);
 assert.match(output,/if\(!completeScan\)/);
 assert.match(output,/if\(!persisted403\)/);
 assert.equal(ctx.complete,false,'noncontiguous excerpt never claims full patch coverage');
 assert.ok(output.length<=ctx.maxTextChars);
});
