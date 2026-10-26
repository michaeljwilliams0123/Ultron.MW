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
 if(reviews[0].user.login!=='coderabbitai[bot]')throw Error('candidate-review-missing');
 return {sourceSha:ref.object.sha,reviewerId:'github:coderabbitai[bot]:136622811'};
}
export async function verifyPersistedAcceptanceEvidence(){return {reviewer:true,evaluation:false};}`;
const sources=(sha,path)=>{
 if(path.endsWith('council-evidence.js'))return council;
 if(sha===CANDIDATE)return acceptance;
 return null;
};

test('base and candidate receive identical 8 cases with persisted per-case receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-compare-'));
 try{
  const path=join(dir,'results.json');
  const report=await compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
   readSource:sources,outputPath:path});
  assert.equal(report.summary.total,8);
  assert.equal(report.summary.baselinePassed,3);
  assert.equal(report.summary.candidatePassed,8);
  assert.equal(report.summary.candidateFailures,0);
  assert.equal(report.heldOutCertified,false);
  assert.equal(report.independentlyObserved,false);
  assert.equal(report.eligibleForProtectedPromotion,false);
  assert.equal(report.cases.length,8);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),report);
  for(const row of report.cases){
   assert.equal(row.baseline.event.caseId,row.candidate.event.caseId);
   assert.equal(row.baseline.event.externalDatabaseReadback,false);
   assert.equal(row.candidate.task.sourceSha,CANDIDATE);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
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
 assert.equal(report.summary.candidateFailures,5);
 assert.equal(report.heldOutCertified,false);
});

test('missing comparison source is an error rather than a passing result',async()=>{
 await assert.rejects(compareSnapshots({baseSha:BASE,candidateSha:CANDIDATE,
  readSource:()=>null}),/required-council-source-missing/);
});
