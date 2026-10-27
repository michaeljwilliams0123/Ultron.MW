import {pathToFileURL} from 'node:url';

export const CONNECTION_NAME='Ultron-Mahoraga-Connection1026';
export const SECRET_NAME='ULTRON_MAHORAGA_CONNECTION1026';
const REPO='michaeljwilliams0123/mahoraga';
const REPO_ID=1343333190;
const API='https://api.github.com/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;

export async function verifyMahoragaToken({
 token,mode='read',actor,runId,fetcher=fetch
}={}){
 if(actor!=='michaeljwilliams0123')throw Error('owner-required');
 if(!['read','write-canary'].includes(mode))throw Error('unsupported-mode');
 if(typeof token!=='string'||!/^[^\s]{20,}$/.test(token))
  throw Error('missing-or-invalid-token');
 if(mode==='write-canary'&&!/^[1-9][0-9]{0,17}$/.test(String(runId||'')))
  throw Error('invalid-run-id');

 const headers={Accept:'application/vnd.github+json',
  Authorization:'Bearer '+token,
  'X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'Ultron-Mahoraga-Connection1026'};
 async function request(path,method='GET',payload){
  if(typeof path!=='string'||(path!==''&&!path.startsWith('/'))||path.includes('..'))
   throw Error('invalid-api-path');
  const response=await fetcher(API+path,{
   method,redirect:'error',
   headers:{...headers,...(payload?{'Content-Type':'application/json'}:{})},
   ...(payload?{body:JSON.stringify(payload)}:{})
  });
  if(response.status===404)return null;
  if(!response.ok)throw Error('mahoraga-api-'+method+'-'+response.status);
  if(response.status===204)return {};
  return response.json();
 }
 const repository=await request('');
 if(repository?.id!==REPO_ID||repository?.full_name!==REPO||
   repository?.private!==true||repository?.default_branch!=='main')
  throw Error('mahoraga-repository-mismatch');
 const main=await request('/git/ref/heads/main');
 const mainSha=main?.object?.sha;
 if(!SHA.test(mainSha||''))throw Error('main-head-unverified');
 // A fresh token may only touch the exact private repository verified above.
 if(mode==='read')return {ok:true,connection:CONNECTION_NAME,
  repository:REPO,mode,mainSha,readVerified:true,writeVerified:false};

 const branch='mahoraga/ultron-conn1026-'+runId;
 const file='docs/ultron/connection-canary-'+runId+'.md';
 const marker='# Ultron Mahoraga connection canary\n\nRun ID: '+runId+
  '\nConnection: '+CONNECTION_NAME+'\nRepository: '+REPO+'\n';
 const refPath='/git/ref/heads/'+branch;
 let ref=await request(refPath);
 if(!ref){
  // Verify main did not advance between admission and the first write.
  const second=await request('/git/ref/heads/main');
  if(second?.object?.sha!==mainSha)throw Error('main-moved-before-branch');
  await request('/git/refs','POST',{ref:'refs/heads/'+branch,sha:mainSha});
  ref=await request(refPath);
 }
 if(!SHA.test(ref?.object?.sha||''))throw Error('canary-ref-unverified');
 const contentPath='/contents/'+file+'?ref='+encodeURIComponent(branch);
 let observed=await request(contentPath);
 if(!observed){
  await request('/contents/'+file,'PUT',{
   message:'test: Ultron Mahoraga PAT branch-write canary '+runId,
   branch,content:Buffer.from(marker,'utf8').toString('base64')
  });
  observed=await request(contentPath);
 }
 if(observed?.encoding!=='base64'||
  Buffer.from(observed.content||'','base64').toString('utf8')!==marker||
  !SHA.test(observed.sha||''))throw Error('canary-file-readback-mismatch');
 const after=await request('/git/ref/heads/main');
 if(after?.object?.sha!==mainSha)throw Error('main-changed-during-canary');
 return {ok:true,connection:CONNECTION_NAME,repository:REPO,mode,
  mainSha,branch,file,readVerified:true,writeVerified:true,
  fileBlobSha:observed.sha};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await verifyMahoragaToken({
   token:process.env.MAHORAGA_PAT,
   actor:process.env.GITHUB_ACTOR,
   mode:process.env.CANARY_MODE||'read',
   runId:process.env.GITHUB_RUN_ID
  });
  console.log(JSON.stringify(result));
 }catch(error){
  console.error('Ultron Mahoraga authorization check failed: '+error.message);
  process.exitCode=1;
 }
}
