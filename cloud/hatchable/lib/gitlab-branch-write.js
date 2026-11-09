import {dataObject,providerBinding,grantRequest,authorizeProvider,
 reconcileProvider,reconcileProviderObserved} from 'lib/mcp-provider-write.js';
import {authorizeOwnerPasskeyProvider} from 'lib/owner-passkey-authorization.js';

const PROJECT_ID=87884831;
const PROJECT_PATH='michaelj.williams0123/Ultron.MW';
const PROJECT='/api/v4/projects/'+PROJECT_ID;
const GITHUB_COMMIT='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/commits/';
// Reviewed GitLab CI workflow at GitHub/GitLab exact commit 531544828c4e...
// Only push events on verify/* branches can run jobs. No ultron/task-* branch
// may dispatch while this byte-for-byte CI contract is not observed.
const SAFE_CI_SHA256='b0499aea45936fe683aa91147fcc9cab8eac8b7bb4912adf7160c4d2ce77f965';
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
function publicResult(result,branch,sourceSha){
 if(result?.status!=='observed')return result;
 if(result.evidence?.branchName!==branch||
  result.evidence?.projectId!==PROJECT_ID||result.evidence?.sourceSha!==sourceSha)return uncertain('invalid-branch-receipt');
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
 // GitLab's project-level custom CI path takes precedence over the normal
 // .gitlab-ci.yml. Reject it before spending any branch creation authority,
 // or the fixed file digest below could falsely imply zero runner usage.
 if(project.body.ci_config_path!=='')
  return held('gitlab-ci-policy-unverified');
 const commit=await gitlab(api,'GET',PROJECT+'/repository/commits/'+sourceSha);
 if(commit.status!==200||commit.body?.id!==sourceSha)
  return held('gitlab-source-commit-unavailable');
 // A branch creation is cash-free only if the source commit's CI rules are
 // exactly the reviewed, verify/*-only workflow. Fail closed on other YAML.
 const ci=await gitlab(api,'GET',PROJECT+'/repository/files/.gitlab-ci.yml/raw',{ref:sourceSha});
 if(ci.status!==200||typeof ci.body!=='string'||ci.body.length>8192)
  return held('gitlab-ci-policy-unverified');
 const digestBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(ci.body)));
 const digest=[...digestBytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==SAFE_CI_SHA256)return held('gitlab-ci-policy-unverified');
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
 }),b.branch,b.request.sourceSha);
}
export async function gitlabBranchWrite({
 mode,request,envelope,passkey,grantId,db,config,api,transport=fetch
}={}){
 let b;
 try{b=await bind(request);}catch{return held('invalid-request');}
 if(mode==='prepare')return {ok:true,grantRequest:grantRequest(b.binding)};
 if(mode==='reconcile'){
  const prior=await reconcileProvider({db,binding:b.binding,grantId});
  if(prior.status!=='reconcile-required'||prior.reason!=='provider-outcome-unresolved')
   return publicResult(prior,b.branch,b.request.sourceSha);
  if(typeof api?.call!=='function')return prior;
  return observed({db,api,b,grantId,providerAcknowledged:false});
 }
 if(mode!=='submit'||(passkey&&envelope))return held('invalid-mode');
 if(typeof api?.call!=='function')return held('gitlab-write-oauth-required');
 const authority=passkey
  ?await authorizeOwnerPasskeyProvider({db,binding:b.binding,proof:passkey})
  :await authorizeProvider({db,config,binding:b.binding,envelope});
 if(authority.error)return publicResult(authority.error,b.branch,b.request.sourceSha);
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
 return observed({db,api,b,grantId:authority.grantId,providerAcknowledged:acknowledged});
}
