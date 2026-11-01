/** Reef #201: candidate-only process with parent-owned scoring expectations.
 * This is a narrow experimental intake evaluator. Candidate stdout is
 * untrusted and never confers release, provenance, or authorization.
 * The existing Reef evaluator is NOT upgraded by importing this module.
 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const RUNNER=fileURLToPath(new URL('../scripts/reef-candidate-only-child.mjs',import.meta.url));
const MAX_BYTES=8192;
function reject(){throw Error('Reef separated admission invalid');}
function permissionFlag(){
 if(process.allowedNodeEnvironmentFlags?.has('--permission'))return '--permission';
 if(process.allowedNodeEnvironmentFlags?.has('--experimental-permission'))
  return '--experimental-permission';
 reject();
}
function executeCandidate({dir,candidate,input,method,timeoutMs}){
 return new Promise(resolve=>{
  let proc,stdout='',timedOut=false,tooLarge=false,settled=false;
  const finish=outcome=>{if(!settled){settled=true;resolve(outcome);}};
  try{
   proc=spawn(process.execPath,[
    permissionFlag(),'--allow-fs-read='+RUNNER,'--allow-fs-read='+dir,
    RUNNER,candidate
   ],{
    cwd:dir,stdio:['pipe','pipe','ignore'],
    env:{PATH:process.env.PATH||'',HOME:dir,TMP:dir,TEMP:dir,
     TMPDIR:dir,NODE_ENV:'test'}
   });
   const timer=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},timeoutMs);
   proc.stdout.setEncoding('utf8');
   proc.stdout.on('data',chunk=>{
    stdout+=chunk;
    if(Buffer.byteLength(stdout)>MAX_BYTES){tooLarge=true;proc.kill('SIGKILL');}
   });
   proc.stdin.on('error',()=>{});
   proc.stdin.end(JSON.stringify({method,input}));
   proc.once('error',()=>{clearTimeout(timer);finish({status:'invalid'});});
   proc.once('close',(code,signal)=>{
    clearTimeout(timer);
    if(timedOut||tooLarge||code!==0||signal)return finish({status:'invalid'});
    let result;
    try{result=JSON.parse(stdout.trim());}catch{return finish({status:'invalid'});}
    if(result?.protocol!=='ultron.reef.untrusted-result.v1'||
       !['returned','rejected'].includes(result.status)||
       Object.keys(result).sort().join(',')!=='protocol,status')
      return finish({status:'invalid'});
    finish({status:result.status});
   });
  }catch{finish({status:'invalid'});}
 });
}
export async function evaluateSeparatedAdmissionCase({
 candidateSource,method,input,expectedStatus,maxPaidCents=0,timeoutMs=5000
}={}){
 if(typeof candidateSource!=='string'||!candidateSource.trim()||
   Buffer.byteLength(candidateSource)>128*1024||
   method!=='admitRepairTask'||
   !input||typeof input!=='object'||Array.isArray(input)||
   !['returned','rejected'].includes(expectedStatus)||maxPaidCents!==0||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)
  reject();
 let request;
 try{request=JSON.stringify(input);}catch{reject();}
 if(!request||Buffer.byteLength(request)>MAX_BYTES)reject();
 const candidateSha256=createHash('sha256').update(candidateSource).digest('hex');
 const dir=await mkdtemp(join(tmpdir(),'ultron-reef-separate-'));
 try{
  const file=join(dir,'candidate.mjs');
  await writeFile(join(dir,'package.json'),'{"type":"module"}',{mode:0o600});
  await writeFile(file,candidateSource,{mode:0o600});
  const observed=await executeCandidate({
   dir,candidate:file,input:JSON.parse(request),method,timeoutMs
  });
  const score=Number(observed.status===expectedStatus);
  return Object.freeze({
   schema:'ultron.reef.separated-admission-prototype.v1',
   candidateSha256,executionPlane:'restricted-child',
   expectedStatus,observedStatus:observed.status,
   score,paidCents:0,resultIsUntrusted:true,signingKeyInChild:false,
   independentlyCertified:false,eligibleForMerge:false,
   disposition:'EXPERIMENTAL_PARENT_SCORING_ONLY'
  });
 }finally{await rm(dir,{recursive:true,force:true});}
}
