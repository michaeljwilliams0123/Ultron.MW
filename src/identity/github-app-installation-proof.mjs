/**
 * Side-effect-free repository verification for the pinned Coordinator GitHub App.
 * A scoped, short-lived metadata-read token is minted, but no repository is
 * mutated and no token/JWT/PEM/provider diagnostic is returned to callers.
 *
 * Keep this file byte-identical to cloud/hatchable/lib/github-app-installation-proof.js.
 */
export const APP_PROOF=Object.freeze({
 repository:'michaeljwilliams0123/Ultron.MW',
 repositoryId:1424939667,
 appId:5633654,
 installationId:179066535,
 owner:'michaeljwilliams0123'
});
const API='https://api.github.com';
// GitHub starts its 1-hour TTL on provider issuance, after our clock read.
const TOKEN_EXPIRY_SKEW_MS=5*60000;
const HEADERS=Object.freeze({Accept:'application/vnd.github+json',
 'X-GitHub-Api-Version':'2022-11-28'});
const result=(reason,fields={})=>Object.freeze({
 schema:'ultron.github-app-installation-proof.v1',
 state:reason===null?'installation-and-scoped-read-verified':'unverified',
 installationVerified:reason===null,
 repositoryReadVerified:reason===null,
 contentsWritePermissionObserved:reason===null,
 externalMutationVerified:false,
 productionAccepted:false,
 ...(reason===null?{}:{reason}),
 ...fields
});
const exactRepo=value=>value?.id===APP_PROOF.repositoryId&&
 value?.full_name===APP_PROOF.repository&&value?.owner?.login===APP_PROOF.owner;
const exactInstallation=value=>value?.id===APP_PROOF.installationId&&
 value?.app_id===APP_PROOF.appId&&value?.account?.login===APP_PROOF.owner&&
 value?.suspended_at===null;
const http=async(fetchImpl,path,opts={})=>{
 const response=await fetchImpl(API+path,{...opts,
  redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{...HEADERS,...opts.headers}});
 if(!response||typeof response.json!=='function')throw Error('provider-invalid');
 const body=await response.json();
 return {status:response.status,body};
};

/**
 * Pure boundary with injected transport and App-JWT signing callback.
 * signJwt must never return its PEM or log the signing material.
 */
export async function probeGithubAppInstallation({credentials,signJwt,
 fetchImpl=globalThis.fetch,now=Date.now()}={}){
 if(String(credentials?.appId)!==String(APP_PROOF.appId)||
    String(credentials?.installationId)!==String(APP_PROOF.installationId)||
    typeof credentials?.privateKey!=='string'||
    !credentials.privateKey.includes('PRIVATE KEY')||
    typeof signJwt!=='function'||typeof fetchImpl!=='function')
  return result('configuration-unverified');
 if(!Number.isFinite(now)||now<=0)return result('clock-unverified');
 try{
  const jwt=await signJwt(credentials,now);
  if(typeof jwt!=='string'||jwt.length<8)return result('signer-unverified');
  const appHeaders={Authorization:'Bearer '+jwt};
  const installation=await http(fetchImpl,
   '/app/installations/'+APP_PROOF.installationId,{method:'GET',headers:appHeaders});
  if(installation.status!==200||!exactInstallation(installation.body)||
     installation.body.permissions?.contents!=='write'||
     installation.body.permissions?.metadata!=='read')
   return result('installation-mismatch');
  const onRepo=await http(fetchImpl,
   '/repos/'+APP_PROOF.repository+'/installation',{method:'GET',headers:appHeaders});
  if(onRepo.status!==200||!exactInstallation(onRepo.body))
   return result('repository-installation-mismatch');
  // Down-scope to metadata read even when the installation permits contents:write.
  const minted=await http(fetchImpl,
   '/app/installations/'+APP_PROOF.installationId+'/access_tokens',{
    method:'POST',headers:{...appHeaders,'Content-Type':'application/json'},
    body:JSON.stringify({repository_ids:[APP_PROOF.repositoryId],
     permissions:{metadata:'read'}})
   });
  const t=minted.body;
  const expiry=Date.parse(t?.expires_at);
  if(minted.status!==201||typeof t?.token!=='string'||t.token.length<8||
     !Number.isFinite(expiry)||expiry<=now||expiry>now+3600000+TOKEN_EXPIRY_SKEW_MS||
     JSON.stringify(t?.permissions)!==JSON.stringify({metadata:'read'})||
     !Array.isArray(t?.repositories)||t.repositories.length!==1||
     !exactRepo(t.repositories[0]))
   return result('token-scope-mismatch');
  const readback=await http(fetchImpl,'/repos/'+APP_PROOF.repository,{
   method:'GET',headers:{Authorization:'Bearer '+t.token}});
  if(readback.status!==200||!exactRepo(readback.body)||
     readback.body.default_branch!=='main')
   return result('repository-readback-mismatch');
  return result(null,{repository:APP_PROOF.repository,
   repositoryId:APP_PROOF.repositoryId,
   appId:APP_PROOF.appId,
   installationId:APP_PROOF.installationId,
   permissionProof:'installation-contents-write-observed; scoped-token-metadata-read',
   paidExternalSpendUSD:0});
 }catch{
  return result('provider-unavailable');
 }
}
