import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCouncilPrContext,formatCouncilPrContext} from '../src/council-pr-context.mjs';
import {scoreCouncilEvidenceCoverage} from '../src/council-evidence-coverage.mjs';

const HEAD='e'.repeat(40),BASE='f'.repeat(40),PR=479;
const change=(filename,patch='+ const safe=true;')=>({filename,status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\n'+patch});
const goodReview={verified:true,sourceSha:HEAD,baseSha:BASE,prNumber:PR,baseUpToDate:true};
const goodFiles={complete:true,sourceSha:HEAD,baseSha:BASE,prNumber:PR,files:[change('src/new.mjs')]};
const coverage=(override={})=>scoreCouncilEvidenceCoverage({
 isPr:true,sourceSha:HEAD,prNumber:PR,reviewEvidence:goodReview,fileEvidence:goodFiles,...override
});
const context=(files,rest={})=>buildCouncilPrContext({sourceSha:HEAD,prNumber:PR,files,...rest});

test('edge Council: corrupt but mutually matching head IDs never score verified 0.90',()=>{
 const invalid='not-a-github-commit-sha';
 assert.equal(coverage({
  sourceSha:invalid,
  reviewEvidence:{...goodReview,sourceSha:invalid},
  fileEvidence:{...goodFiles,sourceSha:invalid}
 }),0.45);
});
test('edge Council: invalid but internally consistent PR numbers cannot score verified',()=>{
 for(const bad of [0,-1,1.5,'479',Number.MAX_SAFE_INTEGER+1]){
  assert.equal(coverage({
   prNumber:bad,reviewEvidence:{...goodReview,prNumber:bad},
   fileEvidence:{...goodFiles,prNumber:bad}
  }),0.45);
 }
});
test('edge Council: filenames containing an access token must not leak in rendered headings',()=>{
 const leaked='github_pat_'+'g'.repeat(30);
 const c=context([change('src/'+leaked+'.mjs')]);
 const s=formatCouncilPrContext(c);
 assert.equal(c.complete,false);
 assert.doesNotMatch(s,new RegExp(leaked));
});
test('edge Council: untrusted control characters and traversal paths are excluded from context',()=>{
 for(const path of ['src/../secret.txt','src/./file.js','src//file.js',
  'src/new\nnewline.js','/etc/passwd','src/\u0000file.js']){
  const c=context([change(path)]);
  assert.equal(c.complete,false,path);
  assert.equal(c.filesRendered,0,path);
  assert.doesNotMatch(formatCouncilPrContext(c),/const safe=true/);
 }
});
test('edge Council: suspicious private-key assignment is fully withheld from external context',()=>{
 const secret='private_key = "super-long-confidential-secret-12345"';
 const c=context([change('src/credentials.js','+ '+secret)]);
 assert.equal(c.complete,false);
 assert.equal(c.redactedFiles,1);
 assert.doesNotMatch(formatCouncilPrContext(c),/super-long-confidential-secret-12345/);
});
test('edge Council: private and internal-only diff markers trigger fail-closed redaction',()=>{
 for(const marker of ['confidential','INTERNAL_ONLY','do not share','Mahoraga private']){
  const c=context([change('src/config.js','+ '+marker+' file-is-restricted')]);
  assert.equal(c.complete,false,marker);
  assert.equal(c.redactedFiles,1,marker);
  assert.doesNotMatch(formatCouncilPrContext(c),/file-is-restricted/);
 }
});
test('edge Council: binary or omitted patch can never produce a complete score claim',()=>{
 for(const patch of ['',null,undefined]){
  const c=context([change('assets/binary.png',patch)]);
  assert.equal(c.complete,false);
  assert.match(formatCouncilPrContext(c),/patch unavailable/);
 }
});
test('edge Council: an unrecognized GitHub file status becomes unknown rather than trusted',()=>{
 const c=context([{...change('src/feature.mjs'),status:'unrecognized-provider-status'}]);
 assert.equal(c.files[0].status,'unknown');
 assert.match(formatCouncilPrContext(c),/source/);
});
test('edge Council: maxFiles of one enforces file inventory truncation',()=>{
 const c=context([change('src/a.js'),change('src/b.js')],{maxFiles:1});
 assert.equal(c.filesRendered,1);
 assert.equal(c.filesObserved,2);
 assert.equal(c.complete,false);
 assert.doesNotMatch(formatCouncilPrContext(c),/src\/b.js/);
});
test('edge Council: invalid maxFiles and text limits fall back to safe bounded defaults',()=>{
 const c=context([change('src/x.js')],{maxFiles:0,maxTextChars:999999});
 assert.equal(c.maxTextChars,4300);
 assert.equal(c.filesRendered,1);
 assert.equal(c.complete,true);
});
test('edge Council: enforced minimum text budget still marks oversize patches incomplete',()=>{
 const patch=Array.from({length:130},(_,i)=>'+ const case_'+i+'="'+('x'.repeat(30))+'";').join('\n');
 const c=context([change('src/many.js',patch)],{maxTextChars:1000});
 const rendered=formatCouncilPrContext(c);
 assert.equal(c.maxTextChars,1000);
 assert.equal(c.complete,false);
 assert.ok(rendered.length<=1000);
 assert.match(rendered,/partial\/unverified/);
});
test('edge Council: safe source and test patches receive different evidence budgets',()=>{
 const patch=Array.from({length:45},(_,i)=>'+ const row'+i+'='+i+';').join('\n');
 const c=context([change('src/compute.js',patch),change('test/compute.test.mjs',patch)]);
 assert.ok(c.files[0].excerpt.length>c.files[1].excerpt.length);
 assert.equal(c.complete,false);
});
test('edge Council: invalid head and PR metadata are rejected before building context',()=>{
 for(const sourceSha of ['','F'.repeat(40),HEAD+'0',null])
  assert.throws(()=>buildCouncilPrContext({sourceSha,prNumber:PR,files:[]}),/source-sha-invalid/);
 for(const prNumber of [0,-1,'479',1.5])
  assert.throws(()=>buildCouncilPrContext({sourceSha:HEAD,prNumber,files:[]}),/pr-number-invalid/);
});
test('edge Council: non-array changed-file input is never interpreted as empty verified list',()=>{
 for(const files of [null,{},'src/file.js'])
  assert.throws(()=>context(files),/file-list-unavailable/);
});
test('edge Council: context is frozen and invalid formatting cannot create plausible evidence',()=>{
 const c=context([change('src/x.js')]);
 assert.ok(Object.isFrozen(c));
 assert.ok(Object.isFrozen(c.files));
 assert.ok(Object.isFrozen(c.files[0]));
 assert.match(formatCouncilPrContext({...c,sourceSha:'wrong'}),/unavailable/);
});
test('edge Council: check failure and stale base comparison override attractive PR prose',()=>{
 assert.equal(coverage({reviewEvidence:{...goodReview,verified:false}}),0.45);
 assert.equal(coverage({reviewEvidence:{...goodReview,baseUpToDate:false}}),0.45);
 assert.equal(coverage({fileEvidence:{...goodFiles,complete:false}}),0.45);
 assert.equal(coverage({fileEvidence:{...goodFiles,prNumber:480}}),0.45);
});
test('edge Council: security-sensitive hold overrides complete evidence and owner assertions',()=>{
 assert.equal(coverage({securitySensitive:true}),0.35);
 assert.equal(coverage({securitySensitive:true,reviewEvidence:{...goodReview,ownerMode:true}}),0.35);
});
test('edge Council: advisory non-PR score has no authority to imply an audited PR release',()=>{
 assert.equal(scoreCouncilEvidenceCoverage({isPr:false}),0.9);
 assert.equal(scoreCouncilEvidenceCoverage({isPr:false,securitySensitive:true}),0.35);
});
