/** Read-only, fail-closed evidence of ONE installed GitHub App principal.
 * Logical Council persona labels are not GitHub identities or independent reviewers.
 * The trusted getToken adapter is deliberately injected: this module does not
 * read secret files or accept caller-supplied authority/permission profiles.
 */
import {COUNCIL_ROLES} from '../council-publication.mjs';
import {ULTRON_REPOSITORY_ID,ULTRON_GITHUB_PRINCIPAL}
 from '../github-principal-policy.mjs';
// Repository was transferred to an organization; the numeric ID is unchanged.
// This probe accepts only the currently verified canonical full name.
const PROOF_REPOSITORY='Ultron-MW/Ultron.MW';
const IDENTIFIER=/^[1-9][0-9]{0,15}$/;
const permissions=Object.freeze({metadata:'read'});
export function normalizeAppPrivateKey(raw){
 if(typeof raw!=='string')return '';
 return raw.replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\r\n/g,'\n').trim();
}
function summary(status,reason,observedAt,extra={}){
 return Object.freeze({schema:'ultron.council-principal-probe.v1',status,reason,
  observedAt,repository:PROOF_REPOSITORY,personasDefined:COUNCIL_ROLES.length,
  verifiedPrincipalCount:status==='verified'?1:0,
  verifiedIndependentRoleCount:0,
  roleBindings:Object.freeze(COUNCIL_ROLES.map(roleId=>Object.freeze({
   roleId,identityStatus:'logical-persona-only',independentlyAuthenticated:false
  }))),...extra});
}
/**
 * The mintScopedToken adapter must be createScopedInstallationTokenProvider.
 * Its cryptographically authenticated response validates repo ID, permissions
 * and expiry. This function additionally performs an authenticated GitHub GET.
 */
export async function verifyCouncilFleet({env={},mintScopedToken,request=globalThis.fetch,
 now=Date.now}={}){
 const observedAt=new Date(now()).toISOString();
 const appId=String(env.GITHUB_APP_ID||'');
 const installationId=String(env.GITHUB_INSTALLATION_ID||'');
 const privateKey=normalizeAppPrivateKey(env.GITHUB_PRIVATE_KEY);
 if(!IDENTIFIER.test(appId)||!IDENTIFIER.test(installationId)||!privateKey)
  return summary('held','app-installation-credentials-unconfigured',observedAt);
 if(typeof mintScopedToken!=='function'||typeof request!=='function')
  return summary('held','trusted-github-probe-adapter-unavailable',observedAt);
 let issued;
 try{
  issued=await mintScopedToken({operation:'identity.read',
   repositoryId:ULTRON_REPOSITORY_ID,permissions});
 }catch{return summary('held','app-token-unavailable',observedAt);}
 const expires=Date.parse(issued?.expiresAt||'');
 if(typeof issued?.token!=='string'||!issued.token||
  Number(installationId)!==issued.installationId||
  issued.repositoryId!==ULTRON_REPOSITORY_ID||
  !issued.permissions||Object.keys(issued.permissions).length!==1||
  issued.permissions.metadata!=='read'||
  !Number.isFinite(expires)||expires<=now()||expires>now()+3600_000)
  return summary('held','app-token-scope-invalid',observedAt);
 let response;
 try{
  response=await request('https://api.github.com/installation/repositories?per_page=2',{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+issued.token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10','User-Agent':'Ultron-Council-Readback'}
  });
 }catch{return summary('held','github-readback-unavailable',observedAt);}
 // Stop immediately on GitHub rate-limit responses; do not retry under embargo.
 if(response?.status===429||response?.status===403&&
    (response.headers?.get?.('retry-after')!=null||
     response.headers?.get?.('x-ratelimit-remaining')==='0')){
  const retryValue=response.headers?.get?.('retry-after');
  const resetValue=response.headers?.get?.('x-ratelimit-reset');
  const retry=retryValue===null||retryValue===undefined?NaN:Number(retryValue);
  const reset=resetValue===null||resetValue===undefined?NaN:Number(resetValue);
  const untilReset=Number.isFinite(reset)?Math.max(0,Math.ceil(reset-now()/1000)):0;
  const retryAfterSeconds=Math.min(86400,Math.max(60,
   Number.isFinite(retry)&&retry>=0?Math.ceil(retry):0,
   response.headers?.get?.('x-ratelimit-remaining')==='0'?untilReset:0));
  return summary('held','github-rate-limited',observedAt,{retryAfterSeconds});
 }
 if(!response?.ok||response.status!==200)
  return summary('held','github-readback-denied',observedAt);
 let data;
 try{data=await response.json();}catch{
  return summary('held','github-readback-invalid',observedAt);
 }
 const valid=data?.total_count===1&&Array.isArray(data.repositories)&&
  data.repositories.length===1&&data.repositories[0]?.id===ULTRON_REPOSITORY_ID&&
  data.repositories[0]?.full_name===PROOF_REPOSITORY;
 if(!valid)return summary('held','github-repository-scope-invalid',observedAt);
 return summary('verified','scoped-installation-readback',observedAt,{
  principal:ULTRON_GITHUB_PRINCIPAL,
  appId:Number(appId),installationId:Number(installationId),
  operation:'identity.read',permissions,
  evidenceSource:'github-installation-token-and-repositories-api',
  tokenExpiresAt:new Date(expires).toISOString()
 });
}
