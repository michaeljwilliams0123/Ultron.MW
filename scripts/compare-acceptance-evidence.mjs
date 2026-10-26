import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const OBJECTIVE='issue-68-stage-1';
const MAIN='a'.repeat(40), HEAD='b'.repeat(40), TREE='c'.repeat(40), BASE='d'.repeat(40);
const repoUrl='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const reviewBody='<!-- coderabbit-ai-generated:v1 -->\n**Actionable comments posted: 0**';
const caseIds=Object.freeze([
 'valid-source-bound-review', 'edited-manifest-rejected',
 'forged-reviewer-login-rejected', 'forged-reviewer-id-rejected',
 'forged-reviewer-type-rejected', 'stale-main-rejected',
 'review-proxy-never-certifies-heldout', 'uncertain-action-never-replayed',
 'stale-lease-held', 'duplicate-external-action-held'
]);
const digest=s=>createHash('sha256').update(s).digest('hex');
const immutableManifest=Object.freeze({
 schema:'ultron.fixed-comparison-case-set.v1', objectiveId:OBJECTIVE,
 caseIds:[...caseIds],caseSetSha256:digest(JSON.stringify(caseIds)),
 provenance:'PR source; not third-party pre-registered or blinded',
 independentEvaluator:false,heldOutCertified:false
});
function fixtures({edited=false,forged=null}={}){
 const manifest={schema:'ultron.github-review-proxy-manifest.v1',
  objectiveId:OBJECTIVE,baselinePullNumber:103,candidatePullNumber:106,
  candidateHeadSha:HEAD,frozen:true,setsDisjoint:false,
  evaluator:'github-review-actionable-findings-v1',
  scoring:'1/(1+actionable-comments)'};
 const data={
  '/git/ref/heads/main':{object:{sha:MAIN}},
  '/pulls/106':{number:106,merged:true,merge_commit_sha:MAIN,
   user:{login:'michaeljwilliams0123'},head:{sha:HEAD}},
  '/issues/106/comments?per_page=100':[{id:700,
   user:{login:'michaeljwilliams0123'},author_association:'OWNER',
   created_at:'2026-10-25T10:00:00Z',updated_at:edited?'2026-10-25T10:01:00Z':'2026-10-25T10:00:00Z',
   body:'<!-- ultron-review-proxy-manifest:v1\n'+JSON.stringify(manifest)+'\n-->'}],
  '/pulls/106/reviews?per_page=100':[{id:800,
   user:{login:forged==='login'?'attacker':'coderabbitai[bot]',
    id:forged==='id'?333:136622811,type:forged==='type'?'User':'Bot'},
   state:'COMMENTED',commit_id:HEAD,
   submitted_at:'2026-10-25T10:05:00Z',body:reviewBody}],
  ['/commits/'+MAIN]:{commit:{tree:{sha:TREE}}},
  ['/commits/'+HEAD]:{commit:{tree:{sha:TREE}}},
  '/pulls/103':{number:103,merged:true,head:{sha:BASE}},
  '/pulls/103/reviews?per_page=100':[{id:600,
   user:{login:'coderabbitai[bot]',id:136622811,type:'Bot'},
   state:'COMMENTED',commit_id:BASE,
   submitted_at:'2026-10-24T10:00:00Z',body:reviewBody}]
 };
 return async url=>{
  const path=String(url).replace(repoUrl,'');
  if(!Object.hasOwn(data,path))throw Error('fixture-unexpected-url:'+path);
  return {ok:true,json:async()=>data[path]};
 };
}
async function rejectsWith(promise,fragment){
 try{await promise;return false;}catch(e){return String(e?.message ?? e).includes(fragment);}
}
const cases=[
 {id:caseIds[0],needs:'acceptance',run:async({acceptance})=>{
  const r=await acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixtures()});
  return r.reviewerId==='github:coderabbitai[bot]:136622811'&&r.sourceSha===MAIN;
 }},
 {id:caseIds[1],needs:'acceptance',run:async({acceptance})=>
  rejectsWith(acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixtures({edited:true})}),
   'review-proxy-manifest-missing')},
 {id:caseIds[2],needs:'acceptance',run:async({acceptance})=>
  rejectsWith(acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixtures({forged:'login'})}),
   'candidate-review-missing')},
 {id:caseIds[3],needs:'acceptance',run:async({acceptance})=>
  rejectsWith(acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixtures({forged:'id'})}),
   'candidate-review-missing')},
 {id:caseIds[4],needs:'acceptance',run:async({acceptance})=>
  rejectsWith(acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixtures({forged:'type'})}),
   'candidate-review-missing')},
 {id:caseIds[5],needs:'acceptance',run:async({acceptance})=>
  rejectsWith(acceptance.observeAcceptanceEvidence({objectiveId:OBJECTIVE,
   candidatePullNumber:106,sourceSha:'f'.repeat(40),fetchImpl:fixtures()}),
   'source-sha-mismatch')},
 {id:caseIds[6],needs:'acceptance',run:async({acceptance})=>{
  const evidence={
   objectiveId:OBJECTIVE,sourceSha:MAIN,fetchImpl:fixtures(),
   identity:{candidatePullNumber:106,reviewId:800,reviewerId:'github:coderabbitai[bot]:136622811'},
   assessment:{
    schema:'ultron.council-assessment.v1',objectiveId:OBJECTIVE,sourceSha:MAIN,
    role:'independent',reviewer:{kind:'independent-reviewer',
      id:'github:coderabbitai[bot]:136622811',identitySource:'github-review'},
    evidenceObservedAt:'2026-10-25T10:05:00.000Z',evidenceFreshness:'fresh',
    assessment:'independent-review-clear',recommendation:'observe',
    dissent:[],knownUnknowns:['github-review-is-advisory','review-count-not-held-out-evaluation'],
    authority:{mode:'advisory-only',executable:false,releaseAuthority:'github-protected-pr'},
    modelInvocations:0,creditCost:0,paidFallback:false,
    candidatePullNumber:106,reviewId:800,adapterKey:'acceptance:'+OBJECTIVE+':'+MAIN+':assessment'
   },
   evaluation:{candidatePullNumber:106,baselinePullNumber:103,reviewId:800,
    freezeCommentId:700,baselineScore:1,candidateScore:1,
    evidenceClass:'advisory-review-count-proxy',setsDisjoint:false,
    independentlyObserved:false,evaluator:{kind:'advisory-proxy'},
    verifiedBy:{kind:'github-review-proxy'},
    candidateFailures:null,criticalRegressions:null}};
  const r=await acceptance.verifyPersistedAcceptanceEvidence(evidence);
  const tampered=await acceptance.verifyPersistedAcceptanceEvidence({
   ...evidence,identity:{...evidence.identity,reviewerId:'github:untrusted:0'}
  });
  return r?.reviewer===true&&r.evaluation===false&&
   tampered?.reviewer===false&&tampered?.evaluation===false;
 }},
 {id:caseIds[7],needs:'council',run:async({council})=>{
  const r=council.evaluateCouncilEvidence({objectiveId:OBJECTIVE,
   sourceSha:MAIN,now:'2026-10-25T10:06:00Z',externalActions:[
    {id:'action-1',state:'uncertain',readback:'not-observed'}]});
  return r.eligibleForProtectedPromotion===false&&
   r.reasons.includes('external-action-readback-required')&&
   r.replayExternalActions.length===0;
 }},
 {id:caseIds[8],needs:'council',run:async({council})=>{
  const r=council.evaluateCouncilEvidence({objectiveId:OBJECTIVE,
   sourceSha:MAIN,now:'2026-10-25T10:06:00Z',lease:{state:'expired',tokenMatches:false}});
  return r.eligibleForProtectedPromotion===false&&
   r.reasons.includes('stale-or-mismatched-lease');
 }},
 {id:caseIds[9],needs:'council',run:async({council})=>{
  const r=council.evaluateCouncilEvidence({objectiveId:OBJECTIVE,
   sourceSha:MAIN,now:'2026-10-25T10:06:00Z',externalActions:[
    {id:'action-1',state:'not-started',readback:'not-observed'},
    {id:'action-1',state:'not-started',readback:'not-observed'}]});
  return r.eligibleForProtectedPromotion===false&&
   r.reasons.includes('external-action-evidence-duplicate');
 }}
];
if(JSON.stringify(cases.map(c=>c.id))!==JSON.stringify(caseIds))
 throw Error('evaluator-case-set-mismatch');
async function loadSource(source){
 if(source===null)return null;
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
async function loadVariant(sha,readSource){
 const [acceptance,council]=await Promise.all([
  readSource(sha,'cloud/hatchable/lib/acceptance-evidence.js'),
  readSource(sha,'cloud/hatchable/lib/council-evidence.js')]);
 if(council===null)throw Error('required-council-source-missing:'+sha);
 let adapter,councilModule;
 try{adapter=await loadSource(acceptance);}
 catch(error){adapter={loadError:String(error?.message ?? error)};}
 try{councilModule=await loadSource(council);}
 catch(error){councilModule={loadError:String(error?.message ?? error)};}
 return {acceptance:adapter,council:councilModule};
}
async function evaluateSource(sha,readSource){
 const modules=await loadVariant(sha,readSource);
 const outcomes=[];
 for(const item of cases){
  let passed=false,reason='assertion-failed';
  if(modules[item.needs]===null)reason='capability-not-present';
  else if(modules[item.needs].loadError)reason='module-load-error:'+modules[item.needs].loadError;
  else try{passed=(await item.run(modules))===true;
   if(passed)reason='observed-pass';
  }catch(e){reason='execution-error:'+String(e?.message ?? e).slice(0,140);}
  outcomes.push({caseId:item.id,sourceSha:sha,passed,reason});
 }
 return outcomes;
}
export async function compareSnapshots({baseSha,candidateSha,readSource,outputPath=null}){
 if(!SHA.test(baseSha)||!SHA.test(candidateSha)||baseSha===candidateSha||
    typeof readSource!=='function')throw Error('invalid-comparison-input');
 const [base,candidate]=await Promise.all([
  evaluateSource(baseSha,readSource),evaluateSource(candidateSha,readSource)]);
 const casesWithReceipts=caseIds.map((id,index)=>{
  const one=base[index],two=candidate[index];
  const receipt=(result,variant)=>({
   task:{taskKey:'fixed-comparison:'+id+':'+variant,objective:'held-out.evaluate',
    sourceSha:result.sourceSha,caseId:id,variant,status:result.passed?'done':'failed'},
   event:{eventType:'observed',source:'github-actions-deterministic',
    externalDatabaseReadback:false,caseId:id,variant,
    outcome:result.passed?'passed':'failed',reason:result.reason}
  });
  return {caseId:id,baseline:receipt(one,'baseline'),candidate:receipt(two,'candidate')};
 });
 const summary={baselinePassed:base.filter(x=>x.passed).length,
  candidatePassed:candidate.filter(x=>x.passed).length,total:caseIds.length,
  candidateFailures:candidate.filter(x=>!x.passed).length};
 const report={schema:'ultron.fixed-comparison-report.v1',objectiveId:OBJECTIVE,
  baseSha,candidateSha,manifest:immutableManifest,
  evaluatorSourceSha256:digest(await readFile(new URL(import.meta.url))),
  evidenceKind:'CI-only-deterministic-task-event-readbacks',
  independentlyObserved:false,heldOutCertified:false,
  eligibleForProtectedPromotion:false,cases:casesWithReceipts,summary};
 if(outputPath){
  const target=resolve(outputPath),tmp=target+'.pending';
  await mkdir(dirname(target),{recursive:true});
  await writeFile(tmp,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await rename(tmp,target);
  const readback=JSON.parse(await readFile(target,'utf8'));
  if(digest(JSON.stringify(readback))!==digest(JSON.stringify(report)))
   throw Error('task-event-artifact-readback-mismatch');
 }
 return report;
}
function gitSource(sha,path){
 try{return execFileSync('git',['show',sha+':'+path],
  {encoding:'utf8',maxBuffer:2*1024*1024});}
 catch(error){
  if(error.status===128)return null;
  throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [baseSha,candidateSha,outputPath]=process.argv.slice(2);
 const report=await compareSnapshots({baseSha,candidateSha,readSource:gitSource,
  outputPath:outputPath||'artifacts/fixed-comparison.json'});
 console.log(JSON.stringify({schema:report.schema,baseSha,candidateSha,
  summary:report.summary,artifact:outputPath||'artifacts/fixed-comparison.json',
  heldOutCertified:false,independentlyObserved:false}));
 if(report.summary.candidateFailures)process.exitCode=1;
}
