/**
 * Read-only JWT preflight for the single Ultron Coordinator GitHub App.
 * This does NOT mint an installation token or approve GitHub writes.
 * Neither PEM, JWT nor HTTP error bodies are serialized or logged.
 */
import {createPrivateKey,sign} from 'node:crypto';
import {normalizeAppPrivateKey} from './council-fleet-verification.mjs';

const APP_ID=5633654;
const APP_SLUG='ultron-coordinator';
const REPOSITORY='michaeljwilliams0123/Ultron.MW';
const REPOSITORY_ID=1424939667;
const OWNER_ID=308995719;
const API='https://api.github.com';
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function makeJwt(appId,pem,now){
 const issued=Math.floor(now/1000);
 const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+
  b64({iat:issued-30,exp:issued+540,iss:String(appId)});
 const signature=sign('RSA-SHA256',Buffer.from(unsigned),createPrivateKey(pem));
 return unsigned+'.'+signature.toString('base64url');
}
function receipt(status,reason,observedAt,extra={}){
 return Object.freeze({schema:'ultron.council-app-installation-diagnostic.v1',
  status,reason,observedAt,repository:REPOSITORY,repositoryId:REPOSITORY_ID,
  appId:APP_ID,appSlug:APP_SLUG,
  appIdentityVerified:false,installationVisible:false,
  verifiedPrincipalCount:0,verifiedIndependentRoleCount:0,...extra});
}
export async function diagnoseCouncilAppInstallation({
 appId,privateKey,request=globalThis.fetch,now=Date.now
}={}){
 const timestamp=typeof now==='function'?now():NaN;
 const observedAt=Number.isFinite(timestamp)
  ?new Date(timestamp).toISOString():null;
 const held=(reason,extra)=>receipt('held',reason,observedAt,extra);
 const pem=normalizeAppPrivateKey(privateKey);
 if(Number(appId)!==APP_ID||!pem||!Number.isFinite(timestamp))
  return held('coordinator-app-credentials-unconfigured');
 if(typeof request!=='function')
  return held('trusted-github-request-unavailable');
 let jwt;
 try{jwt=makeJwt(APP_ID,pem,timestamp);}
 catch{return held('coordinator-signing-key-invalid');}
 const get=async path=>request(API+path,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{Authorization:'Bearer '+jwt,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28',
   'User-Agent':'Ultron-Council-Installation-Preflight'}
 });
 let appResponse;
 try{appResponse=await get('/app');}
 catch{return held('github-app-metadata-unavailable');}
 if(!appResponse?.ok||appResponse.status!==200)
  return held(appResponse?.status===401?'coordinator-app-jwt-rejected':
   'github-app-metadata-denied');
 let app;
 try{app=await appResponse.json();}catch{
  return held('github-app-metadata-invalid');
 }
 if(app?.id!==APP_ID||app?.slug!==APP_SLUG)
  return held('coordinator-app-identity-mismatch');
 const authenticated={appIdentityVerified:true};
 let installResponse;
 try{installResponse=await get('/repos/'+REPOSITORY+'/installation');}
 catch{return held('github-installation-lookup-unavailable',authenticated);}
 if(installResponse?.status===404)
  return held('coordinator-organization-installation-not-visible',authenticated);
 if(!installResponse?.ok||installResponse.status!==200)
  return held('github-installation-lookup-denied',authenticated);
 let installation;
 try{installation=await installResponse.json();}catch{
  return held('github-installation-response-invalid',authenticated);
 }
 if(!Number.isSafeInteger(installation?.id)||installation.id<=0||
    installation.app_id!==APP_ID||
    installation.account?.login!=='michaeljwilliams0123'||
    installation.account?.id!==OWNER_ID||
    installation.suspended_at!=null)
  return held('coordinator-installation-identity-mismatch',authenticated);
 return receipt('installation-observed','app-jwt-and-repository-installation-readback',
  observedAt,{appIdentityVerified:true,installationVisible:true,
  installationId:installation.id});
}
