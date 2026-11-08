// Read-only private GitLab mirror observation. OAuth is brokered by Hatchable:
// no GitLab token is passed to the tool, read from an env var, or logged.
const PROJECT_ID=87884831;
const PROJECT_PATH='michaelj.williams0123/Ultron.MW';
const GITHUB='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const PROJECT='/api/v4/projects/'+PROJECT_ID;
const GITHUB_REF='https://api.github.com/repos/'+GITHUB+'/git/ref/heads/main';

export async function observeGitLabCI({api,transport=fetch}={}){
 if(typeof api?.call!=='function')throw Error('gitlab-oauth-not-connected');
 const get=async path=>{
  // All callers are fixed paths; the platform-managed API broker attaches
  // the separately authorized GitLab OAuth token, not this source code.
  const response=await api.call('gitlab',{method:'GET',path});
  if(response?.status!==200)throw Error('gitlab-api-unavailable');
  return response.body;
 };
 const project=await get(PROJECT);
 if(project?.id!==PROJECT_ID||project?.path_with_namespace!==PROJECT_PATH||
   project?.visibility!=='private'||project?.default_branch!=='main')
  throw Error('gitlab-project-identity-mismatch');
 const branch=await get(PROJECT+'/repository/branches/main');
 const gitlabSha=branch?.commit?.id;
 if(branch?.name!=='main'||!SHA.test(gitlabSha||''))
  throw Error('gitlab-main-invalid');
 const pipelines=await get(PROJECT+'/pipelines?per_page=20');
 if(!Array.isArray(pipelines)||pipelines.length>20)throw Error('gitlab-pipelines-invalid');
 const observed=pipelines.find(p=>
  Number.isSafeInteger(p?.id)&&p.id>0&&SHA.test(p?.sha||'')&&
  typeof p?.ref==='string'&&/^verify\/[a-z0-9._-]{1,100}$/.test(p.ref)&&
  p.status==='success');
 let response;
 try{
  response=await transport(GITHUB_REF,{method:'GET',redirect:'error',
   headers:{Accept:'application/vnd.github+json','User-Agent':'Ultron-GitLab-Parity'},
   signal:AbortSignal.timeout(8000)});
 }catch{throw Error('github-main-unavailable');}
 if(!response?.ok)throw Error('github-main-unavailable');
 const declared=response.headers?.get('content-length');
 if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>65536))
  throw Error('github-main-invalid');
 let ref;
 try{ref=await response.json();}catch{throw Error('github-main-invalid');}
 const githubSha=ref?.object?.sha;
 if(ref?.ref!=='refs/heads/main'||!SHA.test(githubSha||''))
  throw Error('github-main-invalid');
 return {
  schema:'ultron.gitlab.ci-observation.v1',ok:true,readOnly:true,paidSpendCents:0,
  gitlab:{projectId:PROJECT_ID,projectPath:PROJECT_PATH,visibility:'private',
   mainSha:gitlabSha},
  github:{repository:GITHUB,mainSha:githubSha},
  parity:gitlabSha===githubSha?'exact-main-match':'diverged',
  latestVerification:observed?{
   pipelineId:observed.id,sha:observed.sha,ref:observed.ref,
   url:'https://gitlab.com/'+PROJECT_PATH+'/-/pipelines/'+observed.id,
   matchesGithubMain:observed.sha===githubSha
  }:null,
  // Provider metadata is not an authenticated execution receipt or approval.
  acceptanceVerified:false
 };
}
