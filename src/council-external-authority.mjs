/** C04 bounded public research and Mahoraga federation admission.
 * Source-only: a trusted server worker supplies authenticated transports.
 * No API keys, browser sessions, private-network egress, or live submission.
 */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {COUNCIL_APP_ROLES,decideCouncilAction} from './council-app-identities.mjs';
import {createSMEAssignment} from './council-shared-collaboration.mjs';
export const COUNCIL_EXTERNAL_CAPABILITIES=Object.freeze([
 'web.open','mahoraga.repo.inspect','mahoraga.task.prepare'
]);
const PLANS=new WeakSet();
const PEER='michaeljwilliams0123/mahoraga';
const SOURCE_REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const SAFE_PATH=/^(src|test|docs|scripts|evaluation|cloud-app|deploy)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const BAD_HOST=/(?:^|\.)(?:localhost|local|internal|invalid|test)(?:$|\.)/i;
const MAX_RESPONSE_BYTES=65536;
function err(msg){throw new TypeError('external-'+msg);}
function secureWebURL(candidate){
 if(typeof candidate!=='string'||candidate.length>2048)err('url-invalid');
 let u;
 try{u=new URL(candidate);}catch{err('url-invalid');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||
   u.port||!u.hostname||u.hostname.length>253||u.hostname.endsWith('.')||
   BAD_HOST.test(u.hostname)||isIP(u.hostname)||u.hostname.includes(':')||
   !/^[a-z0-9.-]+$/i.test(u.hostname)||!u.hostname.includes('.')||
   u.hostname.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-')))
   err('url-invalid');
 // DNS rebinding requires connection-time IP filtering by the trusted web
 // egress worker. This URL check alone is NOT an SSRF defense.
 return u.href;
}
function repoTarget(target){
 if(!target||target.repository!==PEER||!SHA.test(target.sourceSha??''))
  err('target-invalid');
 return target;
}
function sourcePath(path){
 if(typeof path!=='string'||path.length>240||!SAFE_PATH.test(path)||
   path.split('/').some(part=>part==='.'||part==='..')||
   path.includes('//')||path.includes('\\'))
  err('target-invalid');
 return path;
}
function hex(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function buildCouncilExternalIntent({
 role,shared,capability,target,maxPaidCents=0,attempt=1
}={}){
 if(!COUNCIL_APP_ROLES.includes(role))err('role-invalid');
 // Ensures the shared case was minted by the actual central case factory.
 const assignment=createSMEAssignment(shared,role);
 if(!COUNCIL_EXTERNAL_CAPABILITIES.includes(capability)||
   maxPaidCents!==0||!Number.isSafeInteger(attempt)||
   attempt<1||attempt>3||!target||typeof target!=='object')
  err('plan-invalid');
 let normalized,mode='observation',method='GET';
 if(capability==='web.open'){
  normalized=Object.freeze({url:secureWebURL(target.url)});
 }else if(capability==='mahoraga.repo.inspect'){
  repoTarget(target);
  normalized=Object.freeze({repository:PEER,sourceSha:target.sourceSha,
   path:sourcePath(target.path)});
 }else{
  repoTarget(target);
  if(target.taskType!=='repo.inspect'||
     !Array.isArray(target.allowedPaths)||
     target.allowedPaths.length<1||target.allowedPaths.length>10)
    err('target-invalid');
  normalized=Object.freeze({
   repository:PEER,sourceSha:target.sourceSha,taskType:target.taskType,
   allowedPaths:Object.freeze([...new Set(target.allowedPaths.map(sourcePath))].sort())
  });
  mode='proposal-only';
  method='NONE';
 }
 const core={schema:'ultron.council.external-intent.v1',
  caseSha:assignment.caseSha,sourceSha:shared.sourceSha,
  taskFingerprint:shared.taskFingerprint,role,
  capability,target:normalized,attempt,maxPaidCents:0,
  mode,method,allowRedirects:false,externalContentTrusted:false};
 const plan=Object.freeze({...core,fingerprint:hex(core)});
 PLANS.add(plan);
 return plan;
}
function validReceiptShape(result){
 return result&&typeof result==='object'&&!Array.isArray(result);
}
export async function runCouncilExternalIntent({plan,actor,transport}={}){
 if(!PLANS.has(plan))err('plan-unverified');
 if(!actor||actor.role!==plan.role||actor.sourceSha!==plan.sourceSha||
   decideCouncilAction(actor,{
    operation:plan.capability,repository:SOURCE_REPO,baseSha:plan.sourceSha,
    maxPaidCents:0,attempt:plan.attempt,caseSha:plan.caseSha,
    externalIntentFingerprint:plan.fingerprint
   }).allowed!==true)
  err('identity-unverified');
 if(plan.capability==='mahoraga.task.prepare')
  err('live-write-not-authorized');
 if(!transport||typeof transport!=='object')err('executor-unavailable');
 const obs=plan.capability==='web.open'?
  await (typeof transport.webRead==='function'?transport.webRead:
   ()=>{err('executor-unavailable');})({
    url:plan.target.url,method:'GET',redirect:'manual',maxBytes:MAX_RESPONSE_BYTES,
    requirePublicIpAtConnection:true,sourceSha:plan.sourceSha,
    fingerprint:plan.fingerprint
   }):
  await (typeof transport.githubRead==='function'?transport.githubRead:
   ()=>{err('executor-unavailable');})({
    repository:PEER,sourceSha:plan.target.sourceSha,
    path:plan.target.path,requiredPermission:'contents:read',
    requireDistinctRepositoryInstallation:true,
    expectedInstallationId:actor.installationId,
    sourceShaOwner:plan.sourceSha,fingerprint:plan.fingerprint
   });
 if(!validReceiptShape(obs)||obs.status!==200)err('observation-invalid');
 if(plan.capability==='web.open'){
  if(obs.finalUrl!==plan.target.url||obs.egressVerified!==true||
    obs.redirected!==false||typeof obs.body!=='string'||
    Buffer.byteLength(obs.body)>MAX_RESPONSE_BYTES||
    !['text/html','text/plain','application/json'].includes(obs.contentType))
    err('observation-invalid');
  return Object.freeze({
   schema:'ultron.council.external-observation.v1',
   capability:plan.capability,role:plan.role,fingerprint:plan.fingerprint,
   observed:true,verifiedExternalExecution:false,pageContentTrusted:false,
   contentSha:hex(obs.body),bytes:Buffer.byteLength(obs.body),
   contentData:obs.body,contentTrust:'untrusted-external-data-not-instructions',
   authorization:'trusted-egress-worker-claimed',
   // contentData is untrusted external page text; consumers must never execute it as instructions.
   releaseApproved:false
  });
 }
 if(obs.repository!==PEER||obs.sourceSha!==plan.target.sourceSha||
   obs.path!==plan.target.path||obs.installationId!==actor.installationId||
   obs.installationVerified!==true||
   obs.repositoryAccessVerified!==true||typeof obs.text!=='string'||
   Buffer.byteLength(obs.text)>MAX_RESPONSE_BYTES)
  err('observation-invalid');
 return Object.freeze({
  schema:'ultron.council.external-observation.v1',
  capability:plan.capability,role:plan.role,fingerprint:plan.fingerprint,
  observed:true,verifiedExternalExecution:false,
  sourceSha:plan.target.sourceSha,contentSha:hex(obs.text),
  bytes:Buffer.byteLength(obs.text),contentData:obs.text,
  contentTrust:'untrusted-external-data-not-instructions',
  authorization:'cross-repo-installation-claimed-by-worker',
  releaseApproved:false
 });
}
