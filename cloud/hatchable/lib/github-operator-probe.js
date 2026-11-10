// GitHub OAuth probe: GET only. Passing does not authorize a mutation.
const REPO='Ultron-MW/Ultron.MW';
const REPO_ID=1424939667;
const OWNER_ID=354776009;
const OPERATOR_ID=354634860;
const OPERATOR='michaeljwilliams0123ultron';
const API='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;

function setupRequired(error){
 return error?.code==='SetupRequired'||
  /^gateway internal\/api\/call 412: API "github_operator" is not connected/.test(
   String(error?.message||''));
}
export async function probeGithubOperator(call){
 if(typeof call!=='function')
  return {state:'provider-readback-unavailable'};
 const get=path=>call('github_operator',{method:'GET',path});
 try{
  const identity=await get('/user');
  if(identity?.status!==200)return {state:'principal-unverified'};
  if(identity.body?.login!==OPERATOR||
     identity.body?.id!==OPERATOR_ID||
     identity.body?.type!=='User')
   return {state:'wrong-principal'};
  const [repo,ref]=await Promise.all([get(API),get(API+'/git/ref/heads/main')]);
  if(repo?.status!==200||repo.body?.id!==REPO_ID||
     repo.body?.full_name!==REPO||
     repo.body?.owner?.id!==OWNER_ID||
     repo.body?.owner?.login!=='Ultron-MW'||
     ref?.status!==200||
     ref.body?.ref!=='refs/heads/main'||
     ref.body?.object?.type!=='commit'||
     !SHA.test(ref.body?.object?.sha||''))
   return {state:'repository-unverified'};

  // Each capability is checked separately. 403, 500, or malformed data fails
  // that capability without widening privileges or returning provider data.
  const probes=[
   [API+'/issues?state=open&per_page=1',body=>Array.isArray(body)],
   [API+'/pulls?state=open&per_page=1',body=>Array.isArray(body)],
   [API+'/actions/runs?branch=main&per_page=1',
    body=>Array.isArray(body?.workflow_runs)]
  ];
  const [issues,pullRequests,actions]=await Promise.all(
   probes.map(async ([path,valid])=>{
    try{
     const response=await get(path);
     return response?.status===200&&valid(response.body);
    }catch{return false;}
   })
  );
  return {
   state:'identity-and-repository-read-verified',
   actor:OPERATOR,mainSha:ref.body.object.sha,
   readCapabilities:{issues,pullRequests,actions},
   readCoverage:issues&&pullRequests&&actions?'complete':'partial',
   // Provider-level permission hint, never an owner-signed authorization.
   providerPushFlag:repo.body.permissions?.push===true,
   executionAuthorized:false,liveMutationVerified:false
  };
 }catch(error){
  return {state:setupRequired(error)?'setup-required':
   'provider-readback-unavailable'};
 }
}