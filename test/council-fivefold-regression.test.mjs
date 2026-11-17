import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCouncilPrContext,formatCouncilPrContext}
 from '../src/council-pr-context.mjs';
import {scoreCouncilEvidenceCoverage} from '../src/council-evidence-coverage.mjs';

const SHA='a'.repeat(40),BASE='b'.repeat(40),PR=479;
const workflow=()=>readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
const changed=(filename,patch)=>({filename,status:'modified',additions:1,deletions:0,patch});
const verified={verified:true,sourceSha:SHA,baseSha:BASE,prNumber:PR,baseUpToDate:true};
const files={complete:true,sourceSha:SHA,baseSha:BASE,prNumber:PR,
 files:[changed('src/provenance.mjs','@@ -1 +1 @@\n+ const headMatchesBase=true;')]};
const score=(r=verified,f=files,securitySensitive=false)=>
 scoreCouncilEvidenceCoverage({isPr:true,securitySensitive,reviewEvidence:r,
  fileEvidence:f,sourceSha:SHA,prNumber:PR});
function context(files,other={}){
 return buildCouncilPrContext({sourceSha:SHA,prNumber:PR,files,...other});
}

test('fivefold Council: Coordinator ID and private key use the same isolated identity namespace',()=>{
 const y=workflow();
 assert.match(y,/COUNCIL_COORDINATOR_APP_ID:\s*\$\{\{ vars\.ULTRON_GITHUB_APP_ID \}\}/);
 assert.match(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_COORDINATOR_PRIVATE_KEY \}\}/);
 assert.doesNotMatch(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_BUILDER_PRIVATE_KEY \}\}/);
});
test('fivefold Council: only trusted main is checked out for Council release evaluation',()=>{
 const y=workflow();
 assert.match(y,/actions\/checkout@[a-f0-9]{40}/);
 assert.match(y,/ref: main/);
 assert.doesNotMatch(y,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
 assert.doesNotMatch(y,/refs\/pull\/[0-9]+\/head/);
});
test('fivefold Council: live Coordinator review remains optional and owner restricted',()=>{
 const y=workflow();
 const segment=y.slice(y.indexOf('COUNCIL_COORDINATOR_APP_ID:'),y.indexOf('Retain Council execution evidence'));
 assert.match(y,/env\.OWNER_MODE == '1'/);
 assert.match(y,/vars\.ULTRON_GITHUB_APP_ID == '5633654'/);
 assert.match(y,/continue-on-error: true/);
 assert.doesNotMatch(segment,/GITHUB_TOKEN:\s*\$\{\{/);
});
test('fivefold Council: no raw Coordinator private key or fallback Builder key is in workflow text',()=>{
 const y=workflow();
 assert.equal((y.match(/secrets\.ULTRON_COORDINATOR_PRIVATE_KEY/g)||[]).length,1);
 assert.doesNotMatch(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*['"]?-----BEGIN/);
 assert.doesNotMatch(y,/COUNCIL_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_BUILDER_PRIVATE_KEY/);
});
test('fivefold Council: staged patches allow 12k but never authorize unbounded provider context',()=>{
 const y=workflow();
 assert.match(y,/f\.patch\.length<=12000/);
 assert.match(y,/f\.patch\.slice\(0,12000\)/);
 assert.match(y,/files\.slice\(0,80\)/);
 assert.doesNotMatch(y,/f\.patch\.slice\(0,2400\)/);
});
test('fivefold Council: trusted changed-file evidence pins exact base and head together',()=>{
 const y=workflow();
 assert.match(y,/sourceSha:pr\.head\.sha,baseSha:pr\.base\.sha,prNumber:pr\.number,complete:patchComplete/);
 assert.match(y,/if\(!gate\.councilExactHeadCiReady\(checks\.data,pr\.head\.sha\)\)/);
});
test('fivefold Council: verified exact head, same base and full file inventory score 0.90',()=>{
 assert.equal(score(),0.9);
 assert.equal(score({...verified},structuredClone(files)),0.9);
});
test('fivefold Council: stale CI base SHA cannot inherit a green evidence score',()=>{
 assert.equal(score({...verified,baseSha:'c'.repeat(40)}),0.45);
 assert.equal(score(verified,{...files,baseSha:'d'.repeat(40)}),0.45);
});
test('fivefold Council: missing or malformed file base SHA is treated as unknown',()=>{
 for(const baseSha of [undefined,null,'','invalid',123])
  assert.equal(score(verified,{...files,baseSha}),0.45);
});
test('fivefold Council: stale source SHA in either trusted input is rejected',()=>{
 assert.equal(score({...verified,sourceSha:'c'.repeat(40)}),0.45);
 assert.equal(score(verified,{...files,sourceSha:'c'.repeat(40)}),0.45);
});
test('fivefold Council: incomplete or empty file readback cannot masquerade as full coverage',()=>{
 for(const data of [{...files,complete:false},{...files,files:[]},
  {...files,files:[changed('src/no.patch','')]},
  {...files,files:[{filename:'src/unknown',patch:null}]}])
  assert.equal(score(verified,data),0.45);
});
test('fivefold Council: sensitive workflow diff stays held even with perfect advisory evidence',()=>{
 assert.equal(score(verified,files,true),0.35);
 assert.equal(score({...verified,baseSha:'c'.repeat(40)},files,true),0.35);
});
test('fivefold Council: late SQL guards survive bounded dual-end excerpts with partial warning',()=>{
 const patch=['@@ -1 +1 @@','+ const writeIntentPersisted=true;',
  ...Array.from({length:90},(_,i)=>'+ const value'+i+' = '+i+';'),
  '+ if(!completeScan) fail("readback-unavailable");',
  '+ if(!writeIntentPersisted) return null;'].join('\n');
 const c=context([changed('cloud/hatchable/lib/github-pr-comment-canary.js',patch)]);
 const s=formatCouncilPrContext(c);
 assert.equal(c.complete,false);
 assert.match(s,/writeIntentPersisted=true/);
 assert.match(s,/if\(!completeScan\)/);
 assert.match(s,/if\(!writeIntentPersisted\)/);
 assert.match(s,/noncontiguous source excerpt/);
 assert.match(s,/partial\/unverified/);
 assert.ok(s.length<=c.maxTextChars);
});
test('fivefold Council: secret-path patches remain redacted and incomplete',()=>{
 const c=context([changed('config/secret.pem','@@ -1 +1 @@\n+ some.key=secret')]);
 assert.equal(c.redactedFiles,1);
 assert.equal(c.complete,false);
 assert.match(formatCouncilPrContext(c),/patch redacted/);
 assert.doesNotMatch(formatCouncilPrContext(c),/some\.key=secret/);
});
test('fivefold Council: plaintext GitHub tokens are not leaked to model evidence',()=>{
 const secret='ghp_'+'z'.repeat(30);
 const c=context([changed('src/worker.js','@@ -1 +1 @@\n+ const token="'+secret+'";')]);
 assert.equal(c.redactedFiles,1);
 assert.equal(c.complete,false);
 assert.doesNotMatch(formatCouncilPrContext(c),new RegExp(secret));
});
test('fivefold Council: path traversal and too many changed files never become complete evidence',()=>{
 const input=[changed('src/safe.mjs','@@ -1 +1 @@\n+ const safe=1;'),
  changed('../private.pem','@@ -1 +1 @@\n+ path escaped'),
  changed('/absolute/path','@@ -1 +1 @@\n+ absolute=true'),
  changed('src/another.mjs','@@ -1 +1 @@\n+ other=1')];
 const c=context(input,{maxFiles:3});
 const out=formatCouncilPrContext(c);
 assert.equal(c.complete,false);
 assert.equal(c.filesObserved,4);
 assert.equal(c.filesRendered,1);
 assert.doesNotMatch(out,/path escaped|absolute=true|other=1/);
 assert.match(out,/partial\/unverified/);
});
