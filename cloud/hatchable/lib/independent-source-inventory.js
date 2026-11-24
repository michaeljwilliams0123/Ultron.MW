import {createHash} from 'node:crypto';
// The workflow attests the Git source inventory; the separate authenticated
// Hatchable manifest supplies deployment bytes. This proves content
// attribution, not which historical deploy command or Git commit created them.
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667,WORKFLOW_ID=388875616,PATH='.github/workflows/verify.yml';
const SHA=/^[a-f0-9]{40}$/,HEX=/^[a-f0-9]{64}$/;
const STEPS=['Create exact Hatchable source inventory','Sign Hatchable source inventory','Retain Hatchable source inventory'];
const positive=n=>Number.isSafeInteger(n)&&n>0;
export function sourceInventory(files){
 if(!Array.isArray(files)||!files.length||files.length>1000)throw Error('source-inventory-invalid');
 const seen=new Set();
 const rows=files.map(f=>{
  const path=f?.path,hash=f?.hash;
  if(typeof path!=='string'||!path||path.length>240||path.includes('\\')||
   path.split('/').some(p=>!p||p==='.'||p==='..')||/[\x00-\x1f\x7f]/.test(path)||
   typeof hash!=='string'||!HEX.test(hash)||seen.has(path))throw Error('source-inventory-invalid');
  seen.add(path);return {path,hash};
 }).filter(f=>f.path!=='README.md').sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(!rows.length)throw Error('source-inventory-invalid');
 return {files:rows,count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
export function sourceInventoryArtifactName({sourceSha,digest,count,attempt}){
 if(!SHA.test(sourceSha||'')||!HEX.test(digest||'')||!positive(count)||!positive(attempt))throw Error('source-inventory-identity-invalid');
 return 'hatchable-source-v1-'+sourceSha+'-'+digest+'-'+count+'-'+attempt;
}
export async function verifyIndependentSourceInventory({sourceSha,files,fetchGithub}={}){
 if(!SHA.test(sourceSha||'')||typeof fetchGithub!=='function')return null;
 try{
  const observed=sourceInventory(files);
  async function read(path){
   const r=await fetchGithub(API+path,{method:'GET',cache:'no-store'});
   if(r?.status!==200||!r.ok||/rel="?next"?/i.test(r.headers?.get?.('link')||''))throw Error('source-attestor-read-unavailable');
   return r.json();
  }
  function list(body,key){
   const rows=body?.[key];
   if(!Array.isArray(rows)||body.total_count!==rows.length||rows.length>=100)throw Error('source-attestor-list-incomplete');
   return rows;
  }
  const runs=list(await read('/actions/workflows/verify.yml/runs?head_sha='+sourceSha+'&branch=main&event=push&per_page=100'),'workflow_runs');
  if(!runs.length||runs.some(r=>!positive(r?.id)||r.workflow_id!==WORKFLOW_ID||r.path!==PATH||
   r.head_sha!==sourceSha||r.head_branch!=='main'||r.event!=='push'||
   r.repository?.id!==REPO_ID||r.head_repository?.id!==REPO_ID)||
   new Set(runs.map(r=>r.id)).size!==runs.length)return null;
  const run=runs.reduce((a,b)=>a.id>b.id?a:b);
  if(run.status!=='completed'||run.conclusion!=='success'||!positive(run.run_attempt))return null;
  const jobs=list(await read('/actions/runs/'+run.id+'/jobs?per_page=100'),'jobs').filter(j=>j?.name==='attested-receipt');
  if(jobs.length!==1)return null;
  const job=jobs[0];
  if(job.head_sha!==sourceSha||job.run_attempt!==run.run_attempt||job.status!=='completed'||
   job.conclusion!=='success'||!Array.isArray(job.steps)||!STEPS.every(name=>{
    const steps=job.steps.filter(s=>s?.name===name);
    return steps.length===1&&steps[0].status==='completed'&&steps[0].conclusion==='success';
   }))return null;
  const artifacts=list(await read('/actions/runs/'+run.id+'/artifacts?per_page=100'),'artifacts');
  const expected=sourceInventoryArtifactName({sourceSha,digest:observed.digest,count:observed.count,attempt:run.run_attempt});
  const matches=artifacts.filter(a=>typeof a?.name==='string'&&a.name.startsWith('hatchable-source-v1-'+sourceSha+'-')&&a.name.endsWith('-'+run.run_attempt));
  if(matches.length!==1||matches[0].name!==expected||matches[0].expired!==false||
   !positive(matches[0].id)||!/^sha256:[a-f0-9]{64}$/.test(matches[0].digest||'')||
   matches[0].workflow_run?.id!==run.id||matches[0].workflow_run?.repository_id!==REPO_ID||
   matches[0].workflow_run?.head_repository_id!==REPO_ID||matches[0].workflow_run?.head_branch!=='main'||
   matches[0].workflow_run?.head_sha!==sourceSha)return null;
  const main=await read('/git/ref/heads/main');
  if(main?.object?.sha!==sourceSha)return null;
  return {sourceSha,runId:run.id,artifactId:matches[0].id,sourceDigest:'sha256:'+observed.digest,sourceFileCount:observed.count};
 }catch{return null;}
}
