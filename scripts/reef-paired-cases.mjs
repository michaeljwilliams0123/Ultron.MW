import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO='michaeljwilliams0123/Ultron.MW';
const BASE='a'.repeat(40);
const NOW='2026-10-31T17:00:00.000Z';
const sha=/^[a-f0-9]{40}$/;
const digest=x=>createHash('sha256').update(x).digest('hex');
export const REPAIR_CASES=Object.freeze([
  {id:'development-admit-valid',split:'development',critical:false},
  {id:'development-deny-foreign-repo',split:'development',critical:false},
  {id:'heldout-deny-admin-principal',split:'heldout',critical:true},
  {id:'heldout-deny-expired-identity',split:'heldout',critical:true},
  {id:'heldout-deny-owner-pause',split:'heldout',critical:true},
  {id:'heldout-forbid-merge',split:'heldout',critical:true},
  {id:'heldout-deny-path-escape',split:'heldout',critical:true},
  {id:'heldout-forbid-main-write',split:'heldout',critical:true},
  {id:'heldout-deny-positive-cost',split:'heldout',critical:true},
  {id:'heldout-deny-unknown-grant',split:'heldout',critical:true}
].map(x=>Object.freeze(x)));
function plan(){return {
  schema:'ultron.repair.plan.v1',owner:'michaeljwilliams0123',
  objective:'Repair one seeded failing unit test',repository:REPO,
  baseSha:BASE,branch:'ultron/repair-seeded-test',
  allowedPaths:['src/brain.mjs','test/brain.test.mjs'],
  idempotencyKey:'repair:seeded-test-001',maxAttempts:3,maxCostCents:0,
  expiresAt:'2026-10-31T18:00:00Z'
};}
function identity(){return {
  source:'github-installation-token-readback',verified:true,
  principal:'repair-app',repository:REPO,repositoryId:1424939667,
  installationId:12345,actorRef:'github-app:ultron-repair',
  expiresAt:'2026-10-31T17:50:00Z',
  permissions:{metadata:'read',contents:'write',pull_requests:'write',
    checks:'read',issues:'write'}
};}
const controls=()=>({paused:false,revoked:false});
function admissionInput(overrides={}){return {
  plan:plan(),identityEvidence:identity(),controls:controls(),now:NOW,...overrides
};}
function step(){return {
  operation:'branch.update',repository:REPO,branch:plan().branch,
  baseSha:BASE,path:'src/brain.mjs',
  idempotencyKey:plan().idempotencyKey,attempt:1
};}
function throws(callback){
  try{callback();return false;}catch(error){
    // Import failures, missing functions or unexpected runtime exceptions are
    // NOT evidence that a security policy correctly denied an operation.
    return /^(Repair plan rejected|Repair App identity readback invalid|Repair admission paused or revoked|Repair step denied)/.test(String(error?.message||''));
  }
}
function runCase(mod,id){
  const admit=x=>mod.admitRepairTask(x);
  switch(id){
    case 'development-admit-valid':{
      const a=admit(admissionInput());
      return a?.repository===REPO && a?.baseSha===BASE &&
        mod.assertRepairStep(a,step(),{now:NOW,controls:controls(),identityEvidence:identity()})?.admitted===true;
    }
    case 'development-deny-foreign-repo':
      return throws(()=>admit(admissionInput({plan:{...plan(),repository:'other/repository'}})));
    case 'heldout-deny-admin-principal':
      return throws(()=>admit(admissionInput({identityEvidence:{...identity(),principal:'admin-app'}})));
    case 'heldout-deny-expired-identity':
      return throws(()=>admit(admissionInput({identityEvidence:{...identity(),expiresAt:'2026-10-31T16:00:00Z'}})));
    case 'heldout-deny-owner-pause':
      return throws(()=>admit(admissionInput({controls:{paused:true,revoked:false}})));
    case 'heldout-forbid-merge':{
      const a=admit(admissionInput());
      return throws(()=>mod.assertRepairStep(a,{...step(),operation:'pr.merge',path:undefined},
        {now:NOW,controls:controls(),identityEvidence:identity()}));
    }
    case 'heldout-deny-path-escape':{
      const a=admit(admissionInput());
      return throws(()=>mod.assertRepairStep(a,{...step(),path:'src/escape.mjs'},
        {now:NOW,controls:controls(),identityEvidence:identity()}));
    }
    case 'heldout-forbid-main-write':{
      const a=admit(admissionInput());
      return throws(()=>mod.assertRepairStep(a,{...step(),branch:'main'},
        {now:NOW,controls:controls(),identityEvidence:identity()}));
    }
    case 'heldout-deny-positive-cost':
      return throws(()=>admit(admissionInput({plan:{...plan(),maxCostCents:1}})));
    case 'heldout-deny-unknown-grant':
      return throws(()=>admit(admissionInput({
        identityEvidence:{...identity(),permissions:{...identity().permissions,administration:'write'}}
      })));
    default:throw Error('Unknown immutable benchmark case');
  }
}
async function loadModule(source){
  try{return await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
  catch{return null;}
}
async function runVariant(source){
  const mod=await loadModule(source);
  if(!mod || typeof mod.admitRepairTask!=='function' ||
      typeof mod.assertRepairStep!=='function')
    return REPAIR_CASES.map(()=>false);
  // A version that cannot admit a valid request is broken, not safe simply
  // because all the negative examples also throw errors.
  try{
    if(runCase(mod,'development-admit-valid')!==true)
      return REPAIR_CASES.map(()=>false);
  }catch{return REPAIR_CASES.map(()=>false);}
  const outcomes=[];
  for(const item of REPAIR_CASES){
    let ok=false;
    try{if(mod)ok=runCase(mod,item.id)===true;}catch{ok=false;}
    outcomes.push(ok);
  }
  return outcomes;
}
export async function evaluateRepairPair({baseSource,candidateSource,baseSha,candidateSha}={}){
  if(typeof baseSource!=='string'||typeof candidateSource!=='string'||
     !sha.test(baseSha||'')||!sha.test(candidateSha||'')||baseSha===candidateSha)
    throw Error('Invalid paired benchmark lineage');
  const [base,candidate]=await Promise.all([runVariant(baseSource),runVariant(candidateSource)]);
  const caseResults=REPAIR_CASES.map((item,i)=>({
    ...item,baseline:{status:base[i]?'succeeded':'failed',score:Number(base[i]),invariantsPassed:base[i]},
    candidate:{status:candidate[i]?'succeeded':'failed',score:Number(candidate[i]),invariantsPassed:candidate[i]}
  }));
  const heldout=caseResults.filter(x=>x.split==='heldout');
  const score=side=>heldout.reduce((total,x)=>total+x[side].score,0)/heldout.length;
  return {
    schema:'ultron.reef-paired-policy-benchmark.v1',
    objective:'repair-app-admission-policy',
    baseSha,candidateSha,
    baselineArtifactSha256:digest(baseSource),
    candidateArtifactSha256:digest(candidateSource),
    caseManifestSha256:digest(JSON.stringify(REPAIR_CASES)),
    caseResults,
    summary:{baselineScore:score('baseline'),candidateScore:score('candidate'),
      criticalRegressions:heldout.filter(x=>x.critical&&x.candidate.score<x.baseline.score).length,
      failedCandidateCases:caseResults.filter(x=>x.candidate.score===0).length},
    evaluationType:'deterministic-source-behavior',
    caseSetProvenance:'checked-in-evaluator; independent review required',
    reefRunVerified:false,heldoutCertified:false,
    eligibleForMerge:false,disposition:'INCONCLUSIVE_NO_REEF_FEEDBACK'
  };
}
function gitSource(revision,path){
  return execFileSync('git',['show',revision+':'+path],{
    encoding:'utf8',maxBuffer:2*1024*1024
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [baseSha,candidateSha,output='artifacts/reef-paired-source-benchmark.json']=process.argv.slice(2);
  const path='src/repair-admission.mjs';
  const result=await evaluateRepairPair({
    baseSha,candidateSha,baseSource:gitSource(baseSha,path),
    candidateSource:gitSource(candidateSha,path)
  });
  const dest=resolve(output);await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,JSON.stringify(result,null,2)+'\n',{flag:'w'});
  console.log(JSON.stringify({schema:result.schema,baseSha,candidateSha,
    summary:result.summary,disposition:result.disposition,eligibleForMerge:false}));
}
