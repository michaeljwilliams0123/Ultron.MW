import { createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { spawn,execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile,readFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL,fileURLToPath } from 'node:url';

const REPO='michaeljwilliams0123/Ultron.MW';
const BASE='a'.repeat(40);
const NOW='2026-10-31T17:00:00.000Z';
const sha=/^[a-f0-9]{40}$/;
const digest=x=>createHash('sha256').update(x).digest('hex');
const observationMac=(key,observation)=>createHmac('sha256',key)
 .update(JSON.stringify(observation)).digest('hex');
// Key travels over one-use stdin before importing candidate code. Candidate
// stdout is not evidence; only a message with the trusted runner MAC qualifies.
function spawnObservedChild(inputPath,key,cwd){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[
   fileURLToPath(import.meta.url),'--reef-child',inputPath
  ],{cwd,stdio:['pipe','pipe','ignore'],
    env:{PATH:process.env.PATH||'',HOME:cwd,NODE_ENV:'test'}});
  let output='',killed=false;
  const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL');},30000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',part=>{
   output+=part;
   if(Buffer.byteLength(output,'utf8')>65536){
    killed=true;child.kill('SIGKILL');
   }
  });
  child.stdin.on('error',()=>{}); // early candidate exit must fail on close
  child.stdin.end(key.toString('hex'));
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);
   if(killed||code!==0||signal)reject(Error('Reef child failed'));
   else resolve(output);
  });
 });
}
// Every behavior-affecting source is digest-bound with an explicit absence marker.
const artifactDigest=(admission,executor,policy)=>digest(JSON.stringify([
 admission,
 executor===undefined?{present:false}:{present:true,value:executor},
 policy===undefined?{present:false}:{present:true,value:policy}
]));
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
function plan(unified=false){return {
  schema:'ultron.repair.plan.v1',owner:'michaeljwilliams0123',
  objective:'Repair one seeded failing unit test',repository:REPO,
  baseSha:BASE,branch:'ultron/repair-seeded-test',
  allowedPaths:['src/brain.mjs','test/brain.test.mjs'],
  idempotencyKey:'repair:seeded-test-001',maxAttempts:3,maxCostCents:0,
  expiresAt:'2026-10-31T18:00:00Z',
  ...(unified?{paidFallback:false}:{})
};}
function identity(unified=false,operation='identity.read'){
 if(unified)return {
  source:'github-installation-token-readback',verified:true,
  principal:'ultron-github-app',repository:REPO,repositoryId:1424939667,
  installationId:12345,actorRef:'github-app:ultron-operator',operation,
  expiresAt:'2026-10-31T17:50:00Z',
  permissions:operation==='identity.read'?{metadata:'read'}:
   {metadata:'read',contents:'write'}
 };
 return {
  source:'github-installation-token-readback',verified:true,
  principal:'repair-app',repository:REPO,repositoryId:1424939667,
  installationId:12345,actorRef:'github-app:ultron-repair',
  expiresAt:'2026-10-31T17:50:00Z',
  permissions:{metadata:'read',contents:'write',pull_requests:'write',
    checks:'read',issues:'write'}
 };
}
const controls=()=>({paused:false,revoked:false});
function admissionInput(overrides={},unified=false){return {
  plan:plan(unified),identityEvidence:identity(unified),controls:controls(),now:NOW,...overrides
};}
function step(unified=false){return {
  operation:'branch.update',repository:REPO,branch:plan(unified).branch,
  baseSha:BASE,path:'src/brain.mjs',
  idempotencyKey:plan(unified).idempotencyKey,attempt:1
};}
function throws(callback){
  try{callback();return false;}catch(error){
    // Import failures, missing functions or unexpected runtime exceptions are
    // NOT evidence that a security policy correctly denied an operation.
    return /^(Repair plan rejected|Repair App identity readback invalid|Unified GitHub App identity readback invalid|Repair admission paused or revoked|Repair step denied)/.test(String(error?.message||''));
  }
}
function runCase(mod,id,unified=false){
  const inCase=overrides=>admissionInput(overrides,unified);
  const caseIdentity=(operation='identity.read')=>identity(unified,operation);
  const caseStep=()=>step(unified);
  const casePlan=()=>plan(unified);
  const admit=x=>mod.admitRepairTask(x);
  switch(id){
    case 'development-admit-valid':{
      const a=admit(inCase());
      return a?.repository===REPO && a?.baseSha===BASE &&
        mod.assertRepairStep(a,caseStep(),{now:NOW,controls:controls(),identityEvidence:caseIdentity('repair.branch.update')})?.admitted===true;
    }
    case 'development-deny-foreign-repo':
      return throws(()=>admit(inCase({plan:{...casePlan(),repository:'other/repository'}})));
    case 'heldout-deny-admin-principal':
      return throws(()=>admit(inCase({identityEvidence:{...caseIdentity(),principal:'admin-app'}})));
    case 'heldout-deny-expired-identity':
      return throws(()=>admit(inCase({identityEvidence:{...caseIdentity(),expiresAt:'2026-10-31T16:00:00Z'}})));
    case 'heldout-deny-owner-pause':
      return throws(()=>admit(inCase({controls:{paused:true,revoked:false}})));
    case 'heldout-forbid-merge':{
      const a=admit(inCase());
      return throws(()=>mod.assertRepairStep(a,{...caseStep(),operation:'pr.merge',path:undefined},
        {now:NOW,controls:controls(),identityEvidence:caseIdentity('repair.branch.update')}));
    }
    case 'heldout-deny-path-escape':{
      const a=admit(inCase());
      return throws(()=>mod.assertRepairStep(a,{...caseStep(),path:'src/escape.mjs'},
        {now:NOW,controls:controls(),identityEvidence:caseIdentity('repair.branch.update')}));
    }
    case 'heldout-forbid-main-write':{
      const a=admit(inCase());
      return throws(()=>mod.assertRepairStep(a,{...caseStep(),branch:'main'},
        {now:NOW,controls:controls(),identityEvidence:caseIdentity('repair.branch.update')}));
    }
    case 'heldout-deny-positive-cost':
      return throws(()=>admit(inCase({plan:{...casePlan(),maxCostCents:1}})));
    case 'heldout-deny-unknown-grant':
      return throws(()=>admit(inCase({
        identityEvidence:{...caseIdentity(),permissions:{...caseIdentity().permissions,administration:'write'}}
      })));
    default:throw Error('Unknown immutable benchmark case');
  }
}

const EXECUTION_CASES=Object.freeze([
  {id:'episode-development-create',split:'development',critical:false},
  {id:'episode-development-restart',split:'development',critical:false},
  {id:'episode-heldout-lost-branch-response',split:'heldout',critical:true},
  {id:'episode-heldout-lost-pr-response',split:'heldout',critical:true},
  {id:'episode-heldout-unobserved-branch',split:'heldout',critical:true},
  {id:'episode-heldout-unobserved-pr',split:'heldout',critical:true},
  {id:'episode-heldout-paused-denial',split:'heldout',critical:true},
  {id:'episode-heldout-forged-pr',split:'heldout',critical:true},
  {id:'episode-heldout-key-collision',split:'heldout',critical:true},
  {id:'episode-heldout-concurrent-delivery',split:'heldout',critical:true},
  {id:'episode-heldout-foreign-branch',split:'heldout',critical:true},
].map(item=>Object.freeze(item)));
const exPlan=()=>({
  schema:'ultron.repair.plan.v1',owner:'michaeljwilliams0123',
  objective:'Fix one failing test with protected PR',
  repository:REPO,baseSha:BASE,branch:'ultron/repair-evaluation',
  allowedPaths:['src/seed.mjs','test/seed.test.mjs'],
  idempotencyKey:'repair:reef-episode-001',maxAttempts:2,maxCostCents:0,
  expiresAt:'2026-10-31T18:00:00Z'
});
const exIdentity=()=>({
  source:'github-installation-token-readback',verified:true,
  principal:'repair-app',repository:REPO,repositoryId:1424939667,
  installationId:12345,actorRef:'github-app:ultron-repair',
  expiresAt:'2026-10-31T17:50:00Z',
  permissions:{metadata:'read',contents:'write',pull_requests:'write',
    checks:'read',issues:'write'}
});
const exContext=()=>({now:NOW,controls:{paused:false,revoked:false},
  identityEvidence:exIdentity()});
function exGithub({loseBranch=false,losePR=false,unobservedBranch=false,unobservedPR=false}={}){
  const calls={branch:0,pr:0};
  let branch=null,pr=null;
  const api={
    async getBranch(){return branch&&{...branch};},
    async createBranch({branch:ref,baseSha}){
      calls.branch++;branch={repo:REPO,ref,sha:baseSha};
      if(unobservedBranch)branch=null;
      if(loseBranch||unobservedBranch)throw Error('response-lost');
    },
    async findPR(){return pr&&{...pr};},
    async createPR({branch:ref,base,title,body,draft}){
      calls.pr++;pr={number:71,repo:REPO,head:ref,base,title,body,draft};
      if(unobservedPR)pr=null;
      if(losePR||unobservedPR)throw Error('response-lost');
    }
  };
  return {api,calls,setBranch:value=>{branch=value;},
    setPR:value=>{pr=value;}};
}
const exArgs=(mod,db,extra={})=>({
  ledger:db??mod.createMemoryRepairLedger(),
  github:extra.github?.api??exGithub().api,
  readContext:extra.readContext??exContext,
  plan:extra.plan??exPlan()
});
const exRejects=async(promise,reason)=>{
  try{await promise;return false;}catch(error){
    return reason.test(String(error?.message||''));
  }
};
async function executeCase(mod,id){
  const repo=exGithub();
  const ledger=mod.createMemoryRepairLedger();
  const args=exArgs(mod,ledger,{github:repo});
  switch(id){
    case 'episode-development-create':{
      const r=await mod.runRepairPR(args);
      return r.status==='complete'&&r.prNumber===71&&
        r.branch===exPlan().branch&&r.mergeAuthorized===false&&
        repo.calls.branch===1&&repo.calls.pr===1;
    }
    case 'episode-development-restart':{
      await mod.runRepairPR(args);
      const replay=await mod.runRepairPR(args);
      return replay.status==='complete'&&repo.calls.branch===1&&repo.calls.pr===1;
    }
    case 'episode-heldout-lost-branch-response':{
      const g=exGithub({loseBranch:true});
      const r=await mod.runRepairPR({...args,github:g.api});
      return r.status==='complete'&&g.calls.branch===1&&g.calls.pr===1;
    }
    case 'episode-heldout-lost-pr-response':{
      const g=exGithub({losePR:true});
      const r=await mod.runRepairPR({...args,github:g.api});
      return r.status==='complete'&&g.calls.branch===1&&g.calls.pr===1;
    }
    case 'episode-heldout-unobserved-branch':{
      const g=exGithub({unobservedBranch:true});
      const x=await mod.runRepairPR({...args,github:g.api});
      const y=await mod.runRepairPR({...args,github:g.api});
      return x.status==='reconcile-required'&&y.status==='reconcile-required'&&
        g.calls.branch===1&&g.calls.pr===0;
    }
    case 'episode-heldout-unobserved-pr':{
      const g=exGithub({unobservedPR:true});
      const x=await mod.runRepairPR({...args,github:g.api});
      const y=await mod.runRepairPR({...args,github:g.api});
      return x.status==='reconcile-required'&&y.status==='reconcile-required'&&
        g.calls.branch===1&&g.calls.pr===1;
    }
    case 'episode-heldout-paused-denial':{
      const g=exGithub();
      const denied=await exRejects(mod.runRepairPR(exArgs(mod,ledger,{
        github:g,readContext:async()=>({...exContext(),controls:{paused:true,revoked:false}})
      })),/^Repair admission paused/);
      return denied&&g.calls.branch===0&&g.calls.pr===0;
    }
    case 'episode-heldout-forged-pr':{
      const g=exGithub({losePR:true});
      const original=g.api.createPR;
      g.api.createPR=async input=>{
        try{await original(input);}finally{
          g.setPR({number:71,repo:REPO,head:'main',
            base:'main',title:'forged',body:'forged',draft:false});
        }
      };
      const denied=await exRejects(mod.runRepairPR({...args,github:g.api}),
        /Repair PR readback identity mismatch/);
      return denied&&g.calls.pr===1;
    }
    case 'episode-heldout-key-collision':{
      await mod.runRepairPR(args);
      const alt={...exPlan(),objective:'Another independently admitted objective'};
      const denied=await exRejects(mod.runRepairPR({...args,plan:alt}),
        /fingerprint collision/);
      return denied&&repo.calls.pr===1;
    }
    case 'episode-heldout-concurrent-delivery':{
      const runs=await Promise.all([mod.runRepairPR(args),mod.runRepairPR(args)]);
      return runs.some(r=>r.status==='complete')&&repo.calls.branch===1&&repo.calls.pr===1;
    }
    case 'episode-heldout-foreign-branch':{
      repo.setBranch({repo:REPO,ref:exPlan().branch,sha:BASE});
      const denied=await exRejects(mod.runRepairPR(args),/preexisting branch ownership/);
      return denied&&repo.calls.branch===0&&repo.calls.pr===0;
    }
    default:throw Error('Unknown frozen execution case');
  }
}
async function runExecutionVariant(executorSource,admissionSource,policySource){
  if(typeof executorSource!=='string'||!executorSource.trim())
    return EXECUTION_CASES.map(()=>false);
  const dir=await mkdtemp(join(tmpdir(),'ultron-reef-policy-execution-'));
  try{
    await writeFile(join(dir,'package.json'),'{"type":"module"}');
    await writeFile(join(dir,'repair-admission.mjs'),admissionSource);
    if(typeof policySource==='string'&&policySource.trim())
      await writeFile(join(dir,'github-principal-policy.mjs'),policySource);
    await writeFile(join(dir,'repair-pr-reconciler.mjs'),executorSource);
    let mod;
    try{mod=await import(pathToFileURL(join(dir,'repair-pr-reconciler.mjs')).href);}
    catch{return EXECUTION_CASES.map(()=>false);}
    if(typeof mod.runRepairPR!=='function'||typeof mod.createMemoryRepairLedger!=='function')
      return EXECUTION_CASES.map(()=>false);
    const results=[];
    // Each scenario gets fresh ledger and fake GitHub objects. No live network
    // or owned PR mutation, no evaluator code supplied by the candidate.
    for(const item of EXECUTION_CASES){
      try{results.push(await executeCase(mod,item.id)===true);}
      catch{results.push(false);}
    }
    return results;
  }finally{await rm(dir,{recursive:true,force:true});}
}

async function loadModule(source,policySource){
  const dir=await mkdtemp(join(tmpdir(),'ultron-reef-policy-admission-'));
  try{
    await writeFile(join(dir,'package.json'),'{"type":"module"}');
    await writeFile(join(dir,'repair-admission.mjs'),source);
    if(typeof policySource==='string'&&policySource.trim())
      await writeFile(join(dir,'github-principal-policy.mjs'),policySource);
    return await import(pathToFileURL(join(dir,'repair-admission.mjs')).href);
  }catch{return null;}
  finally{await rm(dir,{recursive:true,force:true});}
}
async function runVariant(source,policySource){
  const mod=await loadModule(source,policySource);
  const unified=typeof policySource==='string'&&
    (/export\s+const\s+ULTRON_GITHUB_PRINCIPAL\s*=/.test(policySource)||
     /export\s*\{[^}]*\bULTRON_GITHUB_PRINCIPAL\b[^}]*\}/.test(policySource));
  if(!mod || typeof mod.admitRepairTask!=='function' ||
      typeof mod.assertRepairStep!=='function')
    return REPAIR_CASES.map(()=>false);
  // A version that cannot admit a valid request is broken, not safe simply
  // because all the negative examples also throw errors.
  try{
    if(runCase(mod,'development-admit-valid',unified)!==true)
      return REPAIR_CASES.map(()=>false);
  }catch{return REPAIR_CASES.map(()=>false);}
  const outcomes=[];
  for(const item of REPAIR_CASES){
    let ok=false;
    try{if(mod)ok=runCase(mod,item.id,unified)===true;}catch{ok=false;}
    outcomes.push(ok);
  }
  return outcomes;
}
async function runIsolatedVariant(source,policySource,executorSource,includeExecutors){
 const failed=()=>({admission:REPAIR_CASES.map(()=>false),
  execution:includeExecutors?EXECUTION_CASES.map(()=>false):[]});
 const dir=await mkdtemp(join(tmpdir(),'ultron-reef-worker-'));
 try{
  const file=join(dir,'input.json');
  await writeFile(file,JSON.stringify({source,policySource,executorSource,includeExecutors}),
   {mode:0o600});
  const key=randomBytes(32);
  const stdout=await spawnObservedChild(file,key,dir);
  const envelope=JSON.parse(stdout.trim());
  const value=envelope?.observation;
  const valid=(rows,n)=>Array.isArray(rows)&&rows.length===n&&
   rows.every(x=>typeof x==='boolean');
  if(!valid(value?.admission,REPAIR_CASES.length)||
     !valid(value?.execution,includeExecutors?EXECUTION_CASES.length:0)||
     typeof envelope?.signature!=='string'||
     !/^[a-f0-9]{64}$/.test(envelope.signature))
    return failed();
  const expected=observationMac(key,value);
  if(!timingSafeEqual(Buffer.from(envelope.signature,'hex'),Buffer.from(expected,'hex')))
   return failed();
  return value;
 }catch{return failed();}
 finally{await rm(dir,{recursive:true,force:true});}
}

export async function evaluateRepairPair({baseSource,candidateSource,baseSha,candidateSha,
  baseExecutorSource=undefined,candidateExecutorSource=undefined,
  basePolicySource=undefined,candidatePolicySource=undefined}={}){
  if(typeof baseSource!=='string'||typeof candidateSource!=='string'||
     !sha.test(baseSha||'')||!sha.test(candidateSha||'')||baseSha===candidateSha)
    throw Error('Invalid paired benchmark lineage');
  const compareExecutors=baseExecutorSource!==undefined||candidateExecutorSource!==undefined;
  const [baseline,candidateResult]=await Promise.all([
   runIsolatedVariant(baseSource,basePolicySource,baseExecutorSource,compareExecutors),
   runIsolatedVariant(candidateSource,candidatePolicySource,candidateExecutorSource,compareExecutors)
  ]);
  const base=baseline.admission,candidate=candidateResult.admission;
  const baseExecution=baseline.execution,candidateExecution=candidateResult.execution;
  const admissionRows=REPAIR_CASES.map((item,i)=>({
    ...item,baseline:{status:base[i]?'succeeded':'failed',score:Number(base[i]),invariantsPassed:base[i]},
    candidate:{status:candidate[i]?'succeeded':'failed',score:Number(candidate[i]),invariantsPassed:candidate[i]}
  }));
  const executionRows=compareExecutors?EXECUTION_CASES.map((item,i)=>({
    ...item,
    baseline:{status:baseExecution[i]?'succeeded':'failed',
      score:Number(baseExecution[i]),invariantsPassed:baseExecution[i]},
    candidate:{status:candidateExecution[i]?'succeeded':'failed',
      score:Number(candidateExecution[i]),invariantsPassed:candidateExecution[i]}
  })):[];
  const caseResults=[...admissionRows,...executionRows];
  const heldout=caseResults.filter(x=>x.split==='heldout');
  const score=side=>heldout.reduce((total,x)=>total+x[side].score,0)/heldout.length;
  return {
    schema:'ultron.reef-paired-policy-benchmark.v1',
    objective:'repair-app-admission-policy',
    baseSha,candidateSha,
    baselineArtifactSha256:artifactDigest(baseSource,baseExecutorSource,basePolicySource),
    candidateArtifactSha256:artifactDigest(candidateSource,candidateExecutorSource,candidatePolicySource),
    caseManifestSha256:digest(JSON.stringify(compareExecutors?
      [...REPAIR_CASES,...EXECUTION_CASES]:REPAIR_CASES)),
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
function tryGitSource(revision,path){
  try{return gitSource(revision,path);}
  catch(error){if(error?.status===128)return undefined;throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href&&
   process.argv[2]==='--reef-child'){
 // Consume stdin fully before loading candidate code: never place the MAC key
 // in command arguments, environment variables, or candidate-readable files.
 const keyHex=readFileSync(0,'utf8').trim();
 if(!/^[a-f0-9]{64}$/.test(keyHex))throw Error('Invalid evaluator observation key');
 const observationKey=Buffer.from(keyHex,'hex');
 const input=JSON.parse(await readFile(process.argv[3],'utf8'));
 const admission=await runVariant(input.source,input.policySource);
 const execution=input.includeExecutors?
  await runExecutionVariant(input.executorSource,input.source,input.policySource):[];
 const observation={admission,execution};
 const signature=observationMac(observationKey,observation);
 process.stdout.write(JSON.stringify({observation,signature})+'\n');
}else if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [baseSha,candidateSha,output='artifacts/reef-paired-source-benchmark.json']=process.argv.slice(2);
  const path='src/repair-admission.mjs';
  const result=await evaluateRepairPair({
    baseSha,candidateSha,baseSource:gitSource(baseSha,path),
    candidateSource:gitSource(candidateSha,path),
    baseExecutorSource:tryGitSource(baseSha,'src/repair-pr-reconciler.mjs'),
    candidateExecutorSource:tryGitSource(candidateSha,'src/repair-pr-reconciler.mjs'),
    basePolicySource:tryGitSource(baseSha,'src/github-principal-policy.mjs'),
    candidatePolicySource:tryGitSource(candidateSha,'src/github-principal-policy.mjs')
  });
  const dest=resolve(output);await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,JSON.stringify(result,null,2)+'\n',{flag:'w'});
  console.log(JSON.stringify({schema:result.schema,baseSha,candidateSha,
    summary:result.summary,disposition:result.disposition,eligibleForMerge:false}));
}
