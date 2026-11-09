/**
 * Injection-safe, read-only workflow dispatch boundary.
 * This is not a replacement for cryptographically signed HITL authorization:
 * mutation-capable operations remain unavailable until that verifier exists.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const REPOSITORY='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const SHA=/^[a-f0-9]{40}$/;
const API='https://api.github.com/repos/'+REPOSITORY;
const ALLOWED=new Set(['github.repo.inspect','github.ci.status']);
const MAX_PAYLOAD_BYTES=8192;

function fail(code){throw Error('governed-'+code);}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function onlyKeys(value,keys){return Object.keys(value).every(key=>keys.includes(key));}

export function assertGovernedDispatch(env){
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_ACTOR!==OWNER||
    env.GITHUB_TRIGGERING_ACTOR!==OWNER||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
    env.GITHUB_REF!=='refs/heads/main'||!SHA.test(env.GITHUB_SHA||''))
   fail('dispatch-not-authorized');
 return env.GITHUB_SHA;
}

export function parseGovernedPayload(raw,sourceSha){
 if(typeof raw!=='string'||!raw.trim()||Buffer.byteLength(raw,'utf8')>MAX_PAYLOAD_BYTES)
   fail('payload-size-invalid');
 let parsed;
 try{parsed=JSON.parse(raw);}catch{fail('payload-json-invalid');}
 if(!object(parsed)||!onlyKeys(parsed,['objectiveId','op','sourceSha','params']))
   fail('payload-structure-invalid');
 if(typeof parsed.objectiveId!=='string'||
    !/^[A-Za-z0-9._:-]{3,80}$/.test(parsed.objectiveId))fail('objective-invalid');
 if(!ALLOWED.has(parsed.op))fail('operation-not-allowlisted');
 if(!SHA.test(parsed.sourceSha||'')||parsed.sourceSha!==sourceSha)
   fail('source-sha-mismatch');
 const params=parsed.params??{};
 if(!object(params)||Object.keys(params).length!==0)fail('params-not-allowed');
 return Object.freeze({objectiveId:parsed.objectiveId,op:parsed.op,
   sourceSha:parsed.sourceSha});
}

/** Runs only fixed GitHub GETs; no subprocess, shell, dynamic URL, or write token. */
export async function runGovernedRequest(raw,{env=process.env,request=globalThis.fetch}={}){
 const sha=assertGovernedDispatch(env);
 const payload=parseGovernedPayload(raw,sha);
 if(!env.GITHUB_TOKEN)fail('read-token-unavailable');
 async function githubGet(path){
   const response=await request(API+path,{
     method:'GET',signal:AbortSignal.timeout(15000),
     headers:{authorization:'Bearer '+env.GITHUB_TOKEN,
       accept:'application/vnd.github+json','user-agent':'ultron-governed-execution'}});
   if(!response.ok)fail('github-read-unavailable');
   return response.json();
 }
 if(payload.op==='github.repo.inspect'){
   const before=await githubGet('/git/ref/heads/main');
   const repository=await githubGet('');
   const after=await githubGet('/git/ref/heads/main');
   const observedSha=before?.object?.sha;
   const ok=observedSha===sha&&after?.object?.sha===sha&&
     repository?.default_branch==='main'&&repository?.full_name===REPOSITORY;
   return {schema:'ultron.governed-dispatch.v1',objectiveId:payload.objectiveId,
     op:payload.op,sourceSha:sha,status:ok?'verified':'failed',
     verification:{method:'exact-main-double-read',ok}};
 }
 const runs=await githubGet('/actions/runs?head_sha='+sha+'&per_page=50');
 const matching=Array.isArray(runs?.workflow_runs)
   ?runs.workflow_runs.filter(r=>r.head_sha===sha):[];
 const relevant=matching.filter(r=>String(r.id)!==String(env.GITHUB_RUN_ID||''));
 const completed=relevant.filter(r=>r.status==='completed');
 const ok=relevant.length>0&&completed.length===relevant.length&&
   completed.every(r=>r.conclusion==='success'||r.conclusion==='skipped');
 return {schema:'ultron.governed-dispatch.v1',objectiveId:payload.objectiveId,
   op:payload.op,sourceSha:sha,status:ok?'verified':'failed',
   verification:{method:'exact-source-completed-runs',ok,
     completedCount:completed.length,pendingCount:relevant.length-completed.length}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const result=await runGovernedRequest(process.env.UNTRUSTED_PAYLOAD);
   console.log(JSON.stringify(result));
   if(result.status!=='verified')process.exitCode=1;
 }catch(error){
   console.error(error instanceof Error&&/^governed-/.test(error.message)
     ?error.message:'governed-execution-failed');
   process.exitCode=1;
 }
}
