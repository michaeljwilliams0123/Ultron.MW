import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HEAD='a'.repeat(40);
const BASE='b'.repeat(40);
const PR=469;
const SCRIPT=fileURLToPath(new URL('../scripts/council-debate.mjs',import.meta.url));
const LONG_BODY=('Acceptance: exact-head tests verify the release behavior and rollback. ')
  .repeat(40);

function exactHeadPayload({head=HEAD}={}){
 return {
  pr:{
   state:'open',number:PR,
   head:{sha:head,repo:{id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'}},
   base:{sha:BASE,ref:'main',repo:{id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'}}
  },
  comparison:{status:'ahead',behind_by:0,merge_base_commit:{sha:BASE}},
  checkRuns:{check_runs:['test','fixed-comparison','attested-receipt'].map((name,index)=>({
   id:index+1,name,head_sha:head,status:'completed',conclusion:'success',
   app:{id:15368,slug:'github-actions'}
  }))}
 };
}

function completeFilesPayload(){
 return {sourceSha:HEAD,prNumber:PR,complete:true,
  files:[{filename:'README.md',status:'modified',additions:1,deletions:1,
   patch:'@@ -1 +1 @@\\n-old\\n+new'}]};
}
function exactHeadFiles(){return {
 sourceSha:HEAD,prNumber:PR,complete:true,
 files:[{filename:'README.md',status:'modified',additions:1,deletions:0,
   patch:'@@ -1 +1 @@\\n+documented proof'}]
};}

function runDebate({evidence=exactHeadPayload(),security='0',
  files=completeFilesPayload()}={}){
 const cwd=mkdtempSync(join(tmpdir(),'ultron-council-evidence-'));
 const evidencePath=join(cwd,'exact-head-ci.json');
 const filesPath=join(cwd,'exact-head-files.json');
 writeFileSync(evidencePath,JSON.stringify(evidence));
 if(files)writeFileSync(filesPath,JSON.stringify(files));
 try{
  const result=spawnSync(process.execPath,[SCRIPT],{
   cwd,encoding:'utf8',env:{...process.env,
    TITLE:'fix(release): bind the Council gate to verified evidence',
    BODY:LONG_BODY,ITEM_NUMBER:String(PR),IS_PR:'true',OWNER_MODE:'1',
    TARGET_SOURCE_SHA:HEAD,ORIGINAL_SECURITY_SIGNAL:security,
    COUNCIL_REVIEW_EVIDENCE_FILE:evidencePath,
    COUNCIL_PR_FILES_FILE:files?filesPath:'',
    GEMINI_API_KEY:'',GROQ_API_KEY:'',COUNCIL_MASTER_SEED:''
   }
  });
  assert.equal(result.status,0,result.stderr||result.stdout);
  return {
   receipt:JSON.parse(readFileSync(join(cwd,'council-receipt.json'),'utf8')),
   members:JSON.parse(readFileSync(join(cwd,'council-members.json'),'utf8'))
  };
 }finally{rmSync(cwd,{recursive:true,force:true})}
}

test('complete trusted exact-head CI and file inventory outrank PR-description length for non-security deliberation',()=>{
 const {receipt,members}=runDebate();
 assert.equal(LONG_BODY.length>2237,true,'fixture must reproduce PR #469 scale');
 assert.equal(receipt.metacognition.evidenceCoverage,0.9);
 assert.equal(receipt.decision,'proceed');
 assert.deepEqual(receipt.positions.map(position=>position.conclusion),
  Array(7).fill('proceed'));
 assert.deepEqual(members.memberAssessments.map(member=>member.verdict),
  Array(7).fill('proceed'));
});

test('long PR prose without matching exact-head evidence remains held',()=>{
 const {receipt}=runDebate({evidence:exactHeadPayload({head:'c'.repeat(40)})});
 assert.equal(receipt.metacognition.evidenceCoverage,0.45);
 assert.equal(receipt.decision,'hold');
 assert.ok(receipt.positions.some(position=>position.conclusion==='hold'));
});

test('trusted exact-head CI never lifts the security classification',()=>{
 const {receipt,members}=runDebate({security:'1'});
 assert.equal(receipt.metacognition.evidenceCoverage,0.35);
 assert.equal(receipt.decision,'hold');
 assert.equal(members.hold,true);
 assert.ok(members.memberAssessments.some(member=>member.verdict==='hold'));
});

test('trusted CI without a complete changed-file inventory still holds',()=>{
 const {receipt}=runDebate({files:null});
 assert.equal(receipt.metacognition.evidenceCoverage,0.45);
 assert.equal(receipt.decision,'hold');
});


test('trusted workflow scopes the same SHA across CI and file readbacks',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 const slice=yaml.split('// Execute read-only CI validation within this *trusted* extraction')[1]
   ?.split('      - name: Run owner-first council debate')[0]||'';
 assert.ok(slice,'trusted extraction step must exist');
 const declaration=slice.indexOf('const sha = targetSourceSha;');
 const readbackTry=slice.indexOf('try {');
 assert.ok(declaration>=0&&declaration<readbackTry,
   'sourceSha must be defined outside both independently caught readbacks');
 assert.equal((slice.match(/const sha = targetSourceSha;/g)||[]).length,1);
});
