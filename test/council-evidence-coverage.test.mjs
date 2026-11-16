import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {scoreCouncilEvidenceCoverage} from '../src/council-evidence-coverage.mjs';

const SHA='a'.repeat(40),BASE='b'.repeat(40),PR=470;
const REPO={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const script=fileURLToPath(new URL('../scripts/council-debate.mjs',import.meta.url));
const trustedChecks=()=>({
 pr:{number:PR,state:'open',head:{sha:SHA,repo:REPO},
   base:{sha:BASE,ref:'main',repo:REPO}},
 comparison:{status:'ahead',behind_by:0,merge_base_commit:{sha:BASE}},
 checkRuns:{check_runs:['test','fixed-comparison','attested-receipt'].map((name,i)=>({
   id:100+i,name,head_sha:SHA,status:'completed',conclusion:'success',
   app:{id:15368,slug:'github-actions'}
 }))}
});
const trustedFiles=()=>({
 sourceSha:SHA,prNumber:PR,complete:true,
 files:[{filename:'README.md',status:'modified',additions:1,deletions:1,
   patch:'@@ -1 +1 @@\\n-old\\n+new'}]
});

test('advisory evidence score cannot be inflated by PR text or missing trusted inputs',()=>{
 const score=(reviewEvidence,fileEvidence,securitySensitive=false)=>
   scoreCouncilEvidenceCoverage({isPr:true,securitySensitive,
     reviewEvidence,fileEvidence,sourceSha:SHA,prNumber:PR});
 const valid={verified:true,sourceSha:SHA,prNumber:PR,baseUpToDate:true};
 assert.equal(score(valid,trustedFiles()),0.9);
 assert.equal(score(null,trustedFiles()),0.45);
 assert.equal(score(valid,null),0.45);
 assert.equal(score({...valid,sourceSha:'c'.repeat(40)},trustedFiles()),0.45);
 assert.equal(score(valid,{...trustedFiles(),complete:false}),0.45);
 assert.equal(score(valid,{...trustedFiles(),files:[]}),0.45);
 assert.equal(score(valid,{...trustedFiles(),prNumber:PR+1}),0.45);
 assert.equal(score(valid,trustedFiles(),true),0.35);
});

function runDebate(length,{badCi=false,noFiles=false,security=false,staleFileSha=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'ultron-evidence-470-'));
 try{
  const ci=trustedChecks();
  if(badCi)ci.checkRuns.check_runs[0].conclusion='failure';
  const ciPath=join(dir,'ci.json'),filesPath=join(dir,'files.json');
  writeFileSync(ciPath,JSON.stringify(ci));
  const files=trustedFiles();
  if(staleFileSha)files.sourceSha='c'.repeat(40);
  if(!noFiles)writeFileSync(filesPath,JSON.stringify(files));
  const env={...process.env,
    TITLE:'Documentation clarification',BODY:'x'.repeat(length),
    ITEM_NUMBER:String(PR),IS_PR:'true',TARGET_SOURCE_SHA:SHA,
    COUNCIL_REVIEW_EVIDENCE_FILE:ciPath,
    COUNCIL_PR_FILES_FILE:noFiles?'':filesPath,
    ORIGINAL_SECURITY_SIGNAL:security?'1':'0',
    OWNER_MODE:'0',ULTRON_AUTONOMY:'0',ULTRON_VELOCITY:'0',
    GEMINI_API_KEY:'',GROQ_API_KEY:'',COUNCIL_MASTER_SEED:'',
    COUNCIL_EXECUTION_RECEIPTS_FILE:'',COUNCIL_TAINT_EVIDENCE_FILE:''
  };
  const result=spawnSync(process.execPath,[script],{
    cwd:dir,env,encoding:'utf8',timeout:30000
  });
  assert.equal(result.status,0,result.stderr||result.stdout);
  return JSON.parse(readFileSync(join(dir,'council-receipt.json'),'utf8'));
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('1,900 and 2,100 character PR descriptions get identical trusted-evidence outcomes',()=>{
 const short=runDebate(1900),long=runDebate(2100);
 assert.equal(short.metacognition.evidenceCoverage,0.9);
 assert.equal(long.metacognition.evidenceCoverage,short.metacognition.evidenceCoverage);
 assert.equal(long.metacognition.action,short.metacognition.action);
 assert.equal(long.decision,short.decision);
});
test('failed or incomplete/stale GitHub evidence holds even with a tiny PR description',()=>{
 for(const options of [
   {badCi:true},{noFiles:true},{staleFileSha:true}
 ]){
  const r=runDebate(12,options);
  assert.equal(r.metacognition.evidenceCoverage,0.45);
  assert.equal(r.decision,'hold');
 }
});
test('sensitive changed paths retain mandatory hold regardless of trusted checks',()=>{
 const r=runDebate(12,{security:true});
 assert.equal(r.metacognition.evidenceCoverage,0.35);
 assert.equal(r.decision,'hold');
});
