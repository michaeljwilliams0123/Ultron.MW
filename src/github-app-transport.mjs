/**
 * Strict REST transport for one Ultron GitHub App installation.
 *
 * getToken() must mint a fresh installation token down-scoped to the requested
 * operation. The transport validates metadata, injects the token in memory,
 * and exposes no token or provider body to its caller. It performs no retries.
 */
import {
 parseInstant,requiredTokenPermissions,ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
} from './github-principal-policy.mjs';

const ROOT='/repos/'+ULTRON_REPOSITORY;
const BRANCH='ultron/[a-z0-9][a-z0-9-]{2,63}';
const ROUTES=Object.freeze({
 'actions.verify.dispatch':[
  ['GET',new RegExp('^'+ROOT+'/actions/workflows/verify\\.yml$')],
  ['GET',new RegExp('^'+ROOT+'/git/ref/heads/'+BRANCH+'$')],
  ['POST',new RegExp('^'+ROOT+'/actions/workflows/verify\\.yml/dispatches$')],
 ],
 'actions.rerun_failed':[
  ['GET',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*$')],
  ['POST',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*/rerun-failed-jobs$')],
 ],
 'actions.cancel':[
  ['GET',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*$')],
  ['POST',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*/cancel$')],
 ],
 'actions.enable':[
  ['GET',new RegExp('^'+ROOT+'/actions/workflows/(?:verify\\.yml|council-debate\\.yml)$')],
  ['PUT',new RegExp('^'+ROOT+'/actions/workflows/(?:verify\\.yml|council-debate\\.yml)/enable$')],
 ],
 'actions.disable':[
  ['GET',new RegExp('^'+ROOT+'/actions/workflows/council-debate\\.yml$')],
  ['PUT',new RegExp('^'+ROOT+'/actions/workflows/council-debate\\.yml/disable$')],
 ],
 'repository.settings.update':[
  ['GET',new RegExp('^'+ROOT+'$')],['PATCH',new RegExp('^'+ROOT+'$')],
 ],
 'webhooks.ping':[
  ['GET',new RegExp('^'+ROOT+'/hooks/[1-9][0-9]*$')],
  ['POST',new RegExp('^'+ROOT+'/hooks/[1-9][0-9]*/pings$')],
 ],
});

function exactPermissions(actual,expected){
 return actual&&typeof actual==='object'&&!Array.isArray(actual)&&
  Object.keys(actual).length===Object.keys(expected).length&&
  Object.entries(expected).every(([key,value])=>actual[key]===value);
}
function routeAllowed(operation,method,path){
 return typeof path==='string'&&path.startsWith(ROOT)&&
  Object.hasOwn(ROUTES,operation)&&
  ROUTES[operation].some(([allowed,re])=>allowed===method&&re.test(path));
}

export function createUnifiedGitHubTransport({
 getToken,expectedInstallationId,fetchImpl=globalThis.fetch,
 clock=()=>new Date().toISOString(),
}={}){
 if(typeof getToken!=='function'||typeof fetchImpl!=='function'||
   typeof clock!=='function'||
   !Number.isSafeInteger(expectedInstallationId)||expectedInstallationId<1)
  throw Error('Unified GitHub transport credential provider required');
 return Object.freeze({
  request:async(operation,method,path,data)=>{
   if(typeof operation!=='string'||typeof method!=='string'||
     !routeAllowed(operation,method,path)||path.includes('?')||path.includes('#')||
     path.includes('%')||path.includes('\\')||/[\r\n]/.test(path)||
     path.split('/').some(segment=>segment==='.'||segment==='..'))
    throw Error('Unified GitHub transport operation, path or method denied');
   const permissions=requiredTokenPermissions(operation);
   const grant=await getToken({operation,repositoryId:ULTRON_REPOSITORY_ID,
    permissions});
   const now=parseInstant(clock()),expires=parseInstant(grant?.expiresAt);
   if(!grant||typeof grant.token!=='string'||grant.token.length<1||
     grant.operation!==operation||grant.repositoryId!==ULTRON_REPOSITORY_ID||
     grant.installationId!==expectedInstallationId||
     !exactPermissions(grant.permissions,permissions)||!Number.isFinite(now)||
     !(expires>now&&expires<=now+60*60*1000))
    throw Error('Unified GitHub transport token profile unavailable');
   const headers={Accept:'application/vnd.github+json',
    Authorization:'Bearer '+grant.token,'X-GitHub-Api-Version':'2026-03-10'};
   if(data!==undefined)headers['Content-Type']='application/json';
   let response;
   try{
    response=await fetchImpl('https://api.github.com'+path,{
     method,headers,redirect:'error',
     ...(data===undefined?{}:{body:JSON.stringify(data)}),
     signal:AbortSignal.timeout(15000),
    });
   }catch{throw Error('Unified GitHub transport outcome unknown; reconcile external state');}
   if(!response?.ok)
    throw Error('Unified GitHub transport HTTP '+String(response?.status??'unknown'));
   if(method==='GET'){
    try{return await response.json();}
    catch{throw Error('Unified GitHub transport unreadable readback');}
   }
   return Object.freeze({status:response.status});
  },
 });
}
