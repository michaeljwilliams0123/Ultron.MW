import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreCouncilEvidenceCoverage} from '../src/council-evidence-coverage.mjs';
import {buildCouncilExactHeadEvidence} from '../src/council-exact-head-evidence.mjs';

const SOURCE='a'.repeat(40), BASE='b'.repeat(40), SHIFTED='c'.repeat(40);
const PR=474;
const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const pr={number:PR,state:'open',head:{sha:SOURCE,repo},base:{sha:BASE,ref:'main',repo}};
const ci=buildCouncilExactHeadEvidence({
 pr,comparison:{status:'ahead',behind_by:0,merge_base_commit:{sha:BASE}},
 checkRuns:{check_runs:['test','fixed-comparison','attested-receipt'].map((name,index)=>({
   id:index+101,name,head_sha:SOURCE,status:'completed',conclusion:'success',
   app:{id:15368,slug:'github-actions'}
 }))}});
const fileInventory=(baseSha)=>({sourceSha:SOURCE,baseSha,prNumber:PR,complete:true,
 files:[{filename:'src/logic.mjs',status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\n-old\n+new'}]});
function score(files,review=ci){return scoreCouncilEvidenceCoverage({
 isPr:true,securitySensitive:false,sourceSha:SOURCE,prNumber:PR,
 reviewEvidence:review,fileEvidence:files
});}

test('the exact-head provider receipt exposes the verified BASE commit',()=>{
 assert.equal(ci.verified,true);
 assert.equal(ci.baseSha,BASE);
});
test('the trusted CI and files must share an exact BASE as well as HEAD',()=>{
 assert.equal(score(fileInventory(BASE)),0.9);
 assert.equal(score(fileInventory(SHIFTED)),0.45,
  'concurrent base branch refresh cannot be scored as complete evidence');
 assert.equal(score(fileInventory(undefined)),0.45,
  'absence of file base SHA must be treated as missing evidence');
 assert.equal(score(fileInventory(BASE),{...ci,baseSha:SHIFTED}),0.45);
});
test('a trusted main workflow pins CI base across file readbacks',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 assert.match(yaml,/let ciBaseSha = ''/);
 assert.match(yaml,/ciBaseSha = current.base.sha/);
 assert.match(yaml,/before.base\?\.sha !== ciBaseSha/);
 assert.match(yaml,/after.base\?\.sha !== ciBaseSha/);
 assert.match(yaml,/baseSha:ciBaseSha/);
});
