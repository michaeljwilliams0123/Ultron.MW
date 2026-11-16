import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const HEAD='a'.repeat(40);
const BASE='b'.repeat(40);
const PR=469;
const SCRIPT=new URL('../scripts/council-debate.mjs',import.meta.url);
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

function runDebate({evidence=exactHeadPayload(),security='0'}={}){
 const cwd=mkdtempSync(join(tmpdir(),'ultron-council-evidence-'));
 const evidencePath=join(cwd,'exact-head-ci.json');
 writeFileSync(evidencePath,JSON.stringify(evidence));
 try{
  const result=spawnSync(process.execPath,[SCRIPT.pathname],{
   cwd,encoding:'utf8',env:{...process.env,
    TITLE:'fix(release): bind the Council gate to verified evidence',
    BODY:LONG_BODY,ITEM_NUMBER:String(PR),IS_PR:'true',OWNER_MODE:'1',
    TARGET_SOURCE_SHA:HEAD,ORIGINAL_SECURITY_SIGNAL:security,
    COUNCIL_REVIEW_EVIDENCE_FILE:evidencePath,
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

test('trusted exact-head CI outranks PR-description length for non-security deliberation',()=>{
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
 assert.equal(receipt.metacognition.evidenceCoverage,0.65);
 assert.equal(receipt.decision,'hold');
 assert.equal(receipt.positions.filter(position=>position.conclusion==='proceed').length,2);
});

test('trusted exact-head CI never lifts the security classification',()=>{
 const {receipt,members}=runDebate({security:'1'});
 assert.equal(receipt.metacognition.evidenceCoverage,0.35);
 assert.equal(receipt.decision,'hold');
 assert.equal(members.hold,true);
 assert.ok(members.memberAssessments.some(member=>member.verdict==='hold'));
});
