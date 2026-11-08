import {dataObject,providerBinding,grantRequest,authorizeProvider,
 reconcileProvider,reconcileProviderObserved} from 'lib/mcp-provider-write.js';

const PROJECT_ID=87884831;
const PROJECT_PATH='michaelj.williams0123/Ultron.MW';
const PROJECT='/api/v4/projects/'+PROJECT_ID;
const GITHUB_COMMIT='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/commits/';
const SHA=/^[a-f0-9]{40}$/;
const KEY=/^[a-z0-9-]{8,48}$/;
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

async function bind(raw){
 const request=dataObject(raw);
 if(Object.keys(request).sort().join(',')!==
   'expectedProfileVersion,expectedStopVersion,key,sourceSha'||
  !KEY.test(request.key||'')||!SHA.test(request.sourceSha||''))
  throw Error('invalid-request');
 const branch='ultron/task-'+request.key;
 const binding=await providerBinding({
  key:request.key,operation:'gitlab.branch.create',
  target:[PROJECT_ID,branch],payload:[request.sourceSha],
  expectedProfileVersion:request.expectedProfileVersion,
  expectedStopVersion:request.expectedStopVersion
 });
 return {request,branch,binding};
}
function publicResult(result,branch){
 if(result?.status!=='observed')return result;
 if(result.evidence?.branchName!==branch||
  result.evidence?.projectId!==PROJECT_ID)return uncertain('invalid-branch-receipt');
 return {...result,branch,url:'https://gitlab.com/'+PROJECT_PATH+'/-/tree/'+branch};
}
async function gitlab(api,method,path,query){
 const response=await api.call('gitlab_write',{
  method,path,...(query===undefined?{}:{query})
 });
 if(!response||!Number.isInteger(response.status))
  throw Error('gitlab-response-invalid');
 return response;
}
function validBranch(observation,branch,sourceSha){
 const row=observation?.body;
 return observation.status===200&&row?.name===branch&&row?.commit?.id===sourceSha&&
  row?.protected===false&&row?.default===false;
}
async function readBranch(api,branch,sourceSha){
 const path=PROJECT+'/repository/branches/'+encodeURIComponent(branch);
 const result=await gitlab(api,'GET',path);
 return {present:validBranch(result,branch,sourceSha),missing:result.status===404,
  conflict:result.status===200&&!validBranch(result,branch,sourceSha)};
}
async function preflight({api,transport,branch,sourceSha}){
 const project=await gitlab(api,'GET',PROJECT);
 if(project.status!==200||project.body?.id!==PROJECT_ID||
  project.body?.path_with_namespace!==PROJECT_PATH||
  project.body?.visibility!=='private'||project.body?.default_branch!=='main')
  return held('gitlab-project-identity-mismatch');
 const commit=await gitlab(api,'GET',PROJECT+'/repository/commits/'+sourceSha);
 if(commit.status!==200||commit.body?.id!==sourceSha)
  return held('gitlab-source-commit-unavailable');
 let response;
 try{response=await transport(GITHUB_COMMIT+sourceSha,{
  method:'GET',redirect:'error',headers:{
   Accept:'application/vnd.github+json','User-Agent':'Ultron-GitLab-Branch-Canary'},
  signal:AbortSignal.timeout(10000)
 });}
 catch{return held('github-source-commit-unavailable');}
 if(!response?.ok)return held('github-source-commit-unavailable');
 let value;
 try{value=await response.json();}
 catch{return held('github-source-commit-unavailable');}
 if(value?.sha!==sourceSha)return held('github-source-commit-mismatch');
 const prior=await readBranch(api,branch,sourceSha);
 if(prior.present||prior.conflict)return held('gitlab-branch-already-exists');
 if(!prior.missing)return held('gitlab-branch-preflight-unavailable');
 return null;
}
async function observed({db,api,b,grantId,providerAcknowledged}){
 let state;
 try{state=await readBranch(api,b.branch,b.request.sourceSha);}
 catch{return uncertain('gitlab-branch-readback-unavailable');}
 if(state.conflict)return held('gitlab-branch-readback-mismatch');
 if(!state.present)return uncertain('gitlab-branch-readback-unavailable');
 return publicResult(await reconcileProviderObserved({
  db,binding:b.binding,grantId,
  evidence:{providerAcknowledged,readbackMatches:true,projectId:PROJECT_ID,
   branchName:b.branch,sourceSha:b.request.sourceSha}
 }),b.branch);
}
export async function gitlabBranchWrite({
 mode,request,envelope,grantId,db,config,api,transport=fetch
}={}){
 let b;
 try{b=await bind(request);}catch{return held('invalid-request');}
 if(mode==='prepare')return {ok:true,grantRequest:grantRequest(b.binding)};
 if(mode==='reconcile'){
  const prior=await reconcileProvider({db,binding:b.binding,grantId});
  if(prior.status!=='reconcile-required'||prior.reason!=='provider-outcome-unresolved')
   return publicResult(prior,b.branch);
  if(typeof api?.call!=='function')return prior;
  return observed({db,api,b,grantId,providerAcknowledged:false});
 }
 if(mode!=='submit')return held('invalid-mode');
 if(typeof api?.call!=='function')return held('gitlab-write-oauth-required');
 const authority=await authorizeProvider({db,config,binding:b.binding,envelope});
 if(authority.error)return publicResult(authority.error,b.branch);
 let pre;
 try{pre=await preflight({api,transport,branch:b.branch,sourceSha:b.request.sourceSha});}
 catch{return held('gitlab-branch-preflight-unavailable');}
 if(pre)return pre;
 let claimed;
 try{claimed=await authority.claim();}
 catch{return uncertain('dispatch-claim-unresolved');}
 if(!claimed)return uncertain('dispatch-not-claimed');
 try{if(!await authority.canDispatch())return uncertain('dispatch-authority-unavailable');}
 catch{return uncertain('dispatch-authority-unavailable');}
 let acknowledged=false;
 try{
  const response=await gitlab(api,'POST',PROJECT+'/repository/branches',{
   branch:b.branch,ref:b.request.sourceSha
  });
  acknowledged=response.status===201&&response.body?.name===b.branch&&
   response.body?.commit?.id===b.request.sourceSha;
 }catch{/* POST may have committed before the acknowledgement was lost. */}
 // Never retry the POST, even when the response was lost or malformed.
 return observed({db,api,b,grantId:null,providerAcknowledged:acknowledged});
}
