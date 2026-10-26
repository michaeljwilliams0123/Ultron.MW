// Shared-corpus scorer for approved Ultron v1.0 learning experiments.
// The corpus is NOT held out; this module never grants production promotion.
// Independent execution identities still require separately trusted attestation.
const DOMAINS=Object.freeze({
 execution:30,recovery:20,security:20,concurrency:15,deployment:10,resources:5
});
const METRICS=Object.freeze({
 completion:35,correctness:25,reliability:20,recovery:10,latency:5,cost:5
});
const SHA=/^[a-f0-9]{40}$/;
const CASE_ID=/^[a-z0-9][a-z0-9-]{3,79}$/;
function reject(label){throw Error(label);}
function validDistribution(cases,key,expected,error){
 for(const [kind,count] of Object.entries(expected)){
  if(cases.filter(c=>c[key]===kind).length!==count)reject(error);
 }
 if(cases.some(c=>!Object.hasOwn(expected,c[key])))reject(error);
}
function normalizeCases(cases){
 if(!Array.isArray(cases)||cases.length!==100)reject('invalid-case-count');
 const seen=new Set();
 for(const item of cases){
  if(!item||!CASE_ID.test(item.caseId||'')||seen.has(item.caseId)||
     typeof item.critical!=='boolean')reject('duplicate-case-id');
  seen.add(item.caseId);
 }
 validDistribution(cases,'domain',DOMAINS,'invalid-case-domain-distribution');
 validDistribution(cases,'dimension',METRICS,'invalid-case-metric-distribution');
 return [...cases].map(c=>({
  caseId:c.caseId,domain:c.domain,dimension:c.dimension,critical:c.critical
 })).sort((a,b)=>a.caseId.localeCompare(b.caseId));
}
function readOutcomes(variant,cases,label){
 if(!variant||!SHA.test(variant.sourceSha||''))reject('invalid-source-pair');
 if(!Array.isArray(variant.outcomes)||variant.outcomes.length!==100)
  reject('incomplete-'+label+'-outcomes');
 const seenIds=new Set(),receipts=new Set(),results=new Map();
 const validCases=new Set(cases.map(c=>c.caseId));
 for(const row of variant.outcomes){
  if(!row||typeof row.caseId!=='string'||!validCases.has(row.caseId)||
     seenIds.has(row.caseId)||!Number.isSafeInteger(row.receiptId)||
     row.receiptId<=0||receipts.has(row.receiptId)||typeof row.passed!=='boolean')
   reject('incomplete-'+label+'-outcomes');
  if(row.sourceSha!==variant.sourceSha)
   reject(label+'-source-mismatch');
  seenIds.add(row.caseId);receipts.add(row.receiptId);
  results.set(row.caseId,row.passed);
 }
 if(seenIds.size!==cases.length)reject('incomplete-'+label+'-outcomes');
 return results;
}
function weightedScore(cases,results){
 let score=0;
 for(const [metric,weight] of Object.entries(METRICS)){
  const selected=cases.filter(c=>c.dimension===metric);
  const passed=selected.filter(c=>results.get(c.caseId)===true).length;
  score+=weight*passed/selected.length;
 }
 return Math.round((score+Number.EPSILON)*100)/100;
}
export async function evaluateSharedEvaluation({
 cases,baseline,candidate,candidateActor,evaluator,reviewer,
 subtle=globalThis.crypto?.subtle
}={}){
 if(!subtle)reject('hash-provider-unavailable');
 if(!candidateActor||typeof candidateActor!=='string'||
    !evaluator||evaluator.kind!=='independent'||typeof evaluator.id!=='string'||
    !reviewer||reviewer.kind!=='independent'||typeof reviewer.id!=='string'||
    !Array.isArray(reviewer.materialDissent)||
    !reviewer.materialDissent.every(x=>typeof x==='string')||
    new Set([candidateActor,evaluator.id,reviewer.id]).size!==3)
  reject('evaluator-independence-not-established');
 const normalized=normalizeCases(cases);
 if(!SHA.test(baseline?.sourceSha||'')||!SHA.test(candidate?.sourceSha||'')||
    baseline.sourceSha===candidate.sourceSha)reject('invalid-source-pair');
 const before=readOutcomes(baseline,normalized,'baseline');
 const after=readOutcomes(candidate,normalized,'candidate');
 const baselineScore=weightedScore(normalized,before);
 const candidateScore=weightedScore(normalized,after);
 const improvementPoints=Math.round((candidateScore-baselineScore+Number.EPSILON)*100)/100;
 const criticalViolations=normalized.filter(c=>c.critical&&!after.get(c.caseId)).length;
 const dissent=reviewer.materialDissent.length;
 const reasons=['shared-corpus-is-not-held-out'];
 if(criticalViolations)reasons.push('critical-case-failure');
 if(dissent)reasons.push('material-dissent-unresolved');
 if(candidateScore<90||improvementPoints<5)reasons.push('shared-threshold-not-met');
 const sharedThresholdMet=candidateScore>=90&&improvementPoints>=5&&
  criticalViolations===0&&dissent===0;
 const bytes=new TextEncoder().encode(JSON.stringify(normalized));
 const digest=await subtle.digest('SHA-256',bytes);
 const caseDigest=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return {
  schema:'ultron.shared-evaluation.v1',
  caseCount:100,caseDigest,baselineSha:baseline.sourceSha,
  candidateSha:candidate.sourceSha,baselineScore,candidateScore,improvementPoints,
  criticalViolations,sharedThresholdMet,
  heldOut:false,eligibleForProtectedPromotion:false,
  researchGate:'held-out-evaluation-not-proven',
  independentExecutionClaim:'unverified-caller-provided-identities',
  requiresExternalAttestation:true,
  reasons
 };
}
