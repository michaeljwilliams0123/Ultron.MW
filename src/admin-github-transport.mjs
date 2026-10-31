/**
 * Strict GitHub REST transport for the separately configured Admin App.
 * Only known admin-executor routes are reachable; injected getToken() must
 * return an already-authorized installation token from trusted server memory.
 * No token minting, token persistence, workflow secret access, or retries.
 */
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const WORKFLOW='(?:verify\\.yml|council-debate\\.yml|continuum-council-supervisor\\.yml)';
const ROUTES=[
 ['GET',new RegExp('^'+ROOT+'$')],
 ['PATCH',new RegExp('^'+ROOT+'$')],
 ['GET',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*$')],
 ['POST',new RegExp('^'+ROOT+'/actions/runs/[1-9][0-9]*/(?:rerun-failed-jobs|cancel)$')],
 ['GET',new RegExp('^'+ROOT+'/actions/workflows/'+WORKFLOW+'$')],
 ['POST',new RegExp('^'+ROOT+'/actions/workflows/'+WORKFLOW+'/dispatches$')],
 ['PUT',new RegExp('^'+ROOT+'/actions/workflows/'+WORKFLOW+'/(?:enable|disable)$')],
 ['GET',new RegExp('^'+ROOT+'/hooks/[1-9][0-9]*$')],
 ['POST',new RegExp('^'+ROOT+'/hooks/[1-9][0-9]*/pings$')],
];
function routeAllowed(method,path){
 if(path!==ROOT&&!path.startsWith(ROOT+'/'))return false;
 return ROUTES.some(([m,re])=>m===method&&re.test(path));
}
export function createAdminGitHubTransport({getToken,fetchImpl=globalThis.fetch}={}){
 if(typeof getToken!=='function'||typeof fetchImpl!=='function')
  throw Error('Admin transport credential provider required');
 return Object.freeze({
  request:async(method,path,data)=>{
   if(typeof method!=='string'||typeof path!=='string'||
     !routeAllowed(method,path)||path.includes('?')||path.includes('#'))
    throw Error('Admin transport path or method denied');
   const grant=await getToken();
   if(!grant||typeof grant.token!=='string'||grant.token.length<1)
    throw Error('Admin transport credential unavailable');
   const headers={
    Accept:'application/vnd.github+json',
    Authorization:'Bearer '+grant.token,
    'X-GitHub-Api-Version':'2026-03-10',
   };
   if(data!==undefined)headers['Content-Type']='application/json';
   let response;
   try{
    response=await fetchImpl('https://api.github.com'+path,{
     method,headers,redirect:'error',
     ...(data===undefined?{}:{body:JSON.stringify(data)}),
     signal:AbortSignal.timeout(15000),
    });
   }catch{
    // An outbound mutation may have committed; caller must reconcile.
    throw Error('Admin transport outcome unknown; reconcile external state');
   }
   if(!response?.ok)
    throw Error('Admin transport GitHub HTTP '+String(response?.status??'unknown'));
   if(method==='GET'){
    try{return await response.json()}catch{throw Error('Admin transport unreadable GitHub readback')}
   }
   return Object.freeze({status:response.status});
  }
 });
}
