import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compareSnapshots} from '../scripts/compare-acceptance-evidence.mjs';
const BASE='1'.repeat(40),CANDIDATE='2'.repeat(40);
const council=`export function evaluateCouncilEvidence({lease,externalActions=[]}){
 const reasons=[];
 if(lease?.state==='expired')reasons.push('stale-or-mismatched-lease');
 if(externalActions.some(a=>a.state==='uncertain'&&a.readback!=='committed'))
  reasons.push('external-action-readback-required');
 if(new Set(externalActions.map(a=>a.id)).size!==externalActions.length)
  reasons.push('external-action-evidence-duplicate');
 return {reasons,eligibleForProtectedPromotion:false,replayExternalActions:[]};
}`;
const acceptance=`const repo='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
export async function observeAcceptanceEvidence({sourceSha,fetchImpl}){
 const ref=await (await fetchImpl(repo+'/git/ref/heads/main')).json();
 if(sourceSha&&sourceSha!==ref.object.sha)throw Error('source-sha-mismatch');
 const comments=await (await fetchImpl(repo+'/issues/106/comments?per_page=100')).json();
 if(comments[0].updated_at!==comments[0].created_at)throw Error('review-proxy-manifest-missing');
 const reviews=await (await fetchImpl(repo+'/pulls/106/reviews?per_page=100')).json();
 const reviewer=reviews[0].user;
 if(reviewer.login!=='coderabbitai[bot]'||reviewer.id!==136622811||
    reviewer.type!=='Bot')throw Error('candidate-review-missing');
 return {sourceSha:ref.object.sha,reviewerId:'github:coderabbitai[bot]:136622811'};
}
export async function verifyPersistedAcceptanceEvidence({identity,assessment}){
 if(identity?.reviewerId!=='github:coderabbitai[bot]:136622811'||
    assessment?.reviewer?.id!==identity.reviewerId||
    assessment?.assessment!=='independent-review-clear')
  return {reviewer:false,evaluation:false};
 return {reviewer:true,evaluation:false};}`;
const sources=(sha,path)=>{
 if(path.endsWith('council-evidence.js'))return council;
 if(sha===CANDIDATE)return acceptance;
 return null;
};

test('base and candidate receive identical 10 cases with persisted per-case receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-compare-'));
 try{
  const path=join(dir,'results.json');
  const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
   readSource:sources,outputPath:path});
  assert.equal(report.summary.total,10);
  assert.equal(report.summary.baselinePassed,3);
  assert.equal(report.summary.candidatePassed,10);
  assert.equal(report.summary.candidateFailures,0);
  assert.equal(report.heldOutCertified,false);
  assert.match(report.evaluatorSourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(report.independentlyObserved,false);
  assert.equal(report.eligibleForProtectedPromotion,false);
  assert.equal(report.cases.length,10);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),report);
  for(const row of report.cases){
   assert.equal(row.baseline.event.caseId,row.candidate.event.caseId);
   assert.equal(row.baseline.event.externalDatabaseReadback,false);
   assert.equal(row.candidate.task.sourceSha,CANDIDATE);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CI comparison rejects a failed reviewer reread even when evaluation stays false',async()=>{
 const untrusted=acceptance.replace('reviewer:true,evaluation:false','reviewer:false,evaluation:false');
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>path.endsWith('council-evidence.js')?council:
   sha===CANDIDATE?untrusted:null});
 assert.equal(report.summary.candidatePassed,9);
 assert.equal(report.summary.candidateFailures,1);
 assert.equal(report.cases.find(c=>c.caseId==='review-proxy-never-certifies-heldout')
  .candidate.event.outcome,'failed');
});

test('invalid sha and identical refs fail closed without any evaluation',async()=>{
 for(const inputs of [[BASE,BASE],['main',CANDIDATE],
  [BASE,'3'.repeat(39)]]){
  await assert.rejects(compareSnapshots({baseSha:inputs[0],candidateSha:inputs[1],
   readSource:sources}),/invalid-comparison-input/);
 }
});

test('execution errors produce failed candidate receipts rather than false improvements',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>path.endsWith('council-evidence.js')?council:
   sha===CANDIDATE?'export function broken () {':null});
 assert.equal(report.summary.candidatePassed,3);
 assert.equal(report.summary.candidateFailures,7);
 assert.equal(report.heldOutCertified,false);
});

test('missing comparison source is an error rather than a passing result',async()=>{
 await assert.rejects(compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:()=>null}),/required-council-source-missing/);
});

test('fixed comparison rejects a reviewer-false result even if evaluation is correctly false',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>{
   const source=sources(sha,path);
   return sha===CANDIDATE&&path.endsWith('acceptance-evidence.js')?
    source.replace('reviewer:true,evaluation:false','reviewer:false,evaluation:false'):source;
  }});
 const row=report.cases.find(c=>c.caseId==='review-proxy-never-certifies-heldout');
 assert.equal(row.candidate.event.outcome,'failed');
 assert.equal(report.summary.candidateFailures,1);
 assert.equal(report.eligibleForProtectedPromotion,false);
});

test('comparison evaluates separately frozen identity spoofing cases',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,readSource:sources});
 const identities=report.cases.filter(c=>c.caseId.startsWith('forged-reviewer-'));
 assert.deepEqual(identities.map(c=>c.caseId),[
  'forged-reviewer-login-rejected',
  'forged-reviewer-id-rejected',
  'forged-reviewer-type-rejected'
 ]);
 assert.equal(identities.every(c=>c.candidate.event.outcome==='passed'),true);
 assert.match(report.manifest.caseSetSha256,/^[a-f0-9]{64}$/);
});

test('council module import failure yields case-level failed receipts and a durable report',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-council-load-'));
 try{
  const path=join(dir,'results.json');
  const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
   outputPath:path,readSource:(sha,file)=>sha===CANDIDATE&&
    file.endsWith('council-evidence.js')?'export function broken () {':sources(sha,file)});
  assert.equal(report.summary.candidatePassed,7);
  assert.equal(report.summary.candidateFailures,3);
  const failed=report.cases.filter(c=>c.candidate.event.reason.startsWith('module-load-error:'));
  assert.equal(failed.length,3);
  assert.deepEqual(failed.map(c=>c.caseId),[
   'uncertain-action-never-replayed','stale-lease-held','duplicate-external-action-held'
  ]);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),report);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('non-Error acceptance import rejection creates failed case receipts',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>sha===CANDIDATE&&path.endsWith('acceptance-evidence.js')?
   'throw null;':sources(sha,path)});
 assert.equal(report.summary.candidateFailures,7);
 assert.equal(report.eligibleForProtectedPromotion,false);
 assert.equal(report.cases.filter(row=>row.candidate.event.reason==='module-load-error:null').length,7);
});

test('non-Error council import rejection creates failed case receipts',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>sha===CANDIDATE&&path.endsWith('council-evidence.js')?
   'throw undefined;':sources(sha,path)});
 assert.equal(report.summary.candidateFailures,3);
 assert.equal(report.eligibleForProtectedPromotion,false);
 assert.equal(report.cases.filter(row=>row.candidate.event.reason==='module-load-error:undefined').length,3);
});

test('non-Error case execution rejection is recorded without aborting report',async()=>{
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>sha===CANDIDATE&&path.endsWith('council-evidence.js')?
   'export function evaluateCouncilEvidence(){throw null;}':sources(sha,path)});
 assert.equal(report.summary.candidateFailures,3);
 assert.equal(report.eligibleForProtectedPromotion,false);
 assert.equal(report.cases.filter(row=>row.candidate.event.reason==='execution-error:null').length,3);
});

test('fixed comparison rejects a permissive verifier that accepts tampered reviewer identity',async()=>{
 const permissive=acceptance.replace(
  'return {reviewer:false,evaluation:false};',
  'return {reviewer:true,evaluation:false};');
 assert.notEqual(permissive,acceptance,'mutation must actually disable the tamper guard');
 const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:(sha,path)=>path.endsWith('council-evidence.js')?council:
   sha===CANDIDATE?permissive:null});
 const row=report.cases.find(c=>c.caseId==='review-proxy-never-certifies-heldout');
 assert.equal(row.candidate.event.outcome,'failed');
 assert.equal(report.summary.candidateFailures,1);
 assert.equal(report.heldOutCertified,false);
 assert.equal(report.eligibleForProtectedPromotion,false);
});
