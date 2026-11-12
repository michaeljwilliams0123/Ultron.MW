import {db,config} from 'hatchable';
import {prepareBranchCanary,validatePreparedBranchCanary,runBranchCanary,
 reconcileBranchCanary,abandonBranchCanary} from 'lib/github-branch-canary.js';

// #412 Option A: owner-only, grant-bound branch canary for the master pipeline.
// prepare/submit/reconcile mirror the C04 PR-comment canary; abandon is the
// owner-only terminal exit for a row whose branch a fresh readback shows absent. repair.branch.create
// stays denied until the owner selects it in the versioned autonomy profile.
export const access='admin';
export const methods=['POST'];
const SCHEMA='ultron.github.branch-canary.v1';
const OWNER='michaeljwilliams0123';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const SHA=/^[a-f0-9]{40}$/;
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const RECONCILE_REASONS=['readback-not-found','readback-conflict','readback-unavailable',
 'intent-conflict','ledger-readback-unavailable','audit-readback-mismatch',
 'audit-readback-unavailable','token-exchange-denied','provider-outcome-unknown'];
const PROVIDER_STATUS={'readback-conflict':'mismatch','audit-readback-mismatch':'mismatch',
 'readback-unavailable':'unavailable','audit-readback-unavailable':'unavailable'};
const ABANDON_REASONS=['abandon-branch-present','abandon-state-in-flight',
 'abandon-state-completed','abandon-state-failed-before-write','intent-conflict',
 'readback-unavailable','ledger-readback-unavailable','abandon-persistence-unverified',
 'token-exchange-denied','provider-outcome-unknown'];
function reply(res,status,value){
 res.setHeader('Cache-Control','private, no-store');
 return res.status(status).json({schema:SCHEMA,...value});
}
function exact(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  Object.keys(value).every(key=>keys.includes(key));
}
async function publicJwk(){
 const encoded=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
 if(typeof encoded!=='string'||encoded.length<20||encoded.length>4096)
  throw Error('configuration');
 return JSON.parse(encoded);
}
async function appCredentials(){
 const [appId,installationId,privateKey]=await Promise.all([
  config.get('ULTRON_GITHUB_APP_ID'),
  config.get('ULTRON_GITHUB_INSTALLATION_ID'),
  config.get('ULTRON_GITHUB_APP_PRIVATE_KEY')
 ]);
 if(String(appId)!=='5633654'||String(installationId)!=='179066535'||
   typeof privateKey!=='string'||!privateKey.includes('PRIVATE KEY'))
  throw Error('configuration');
 return {appId,installationId,privateKey};
}
const unconfigured=res=>reply(res,503,{ok:false,status:'unconfigured',
 error:'github-app-unconfigured'});
export default async function handler(req,res){
 if(req.member?.handle!==OWNER)
  return reply(res,403,{ok:false,error:'owner-identity-required'});
 const origin=req.headers?.origin;
 if(origin&&origin!==ORIGIN)return reply(res,403,{ok:false,error:'origin-denied'});
 if(req.method!=='POST')return reply(res,405,{ok:false,error:'method-not-allowed'});
 const body=req.body,mode=body?.mode;
 if(mode==='prepare'){
  if(!exact(body,['mode','sourceSha'])||!SHA.test(body.sourceSha||''))
   return reply(res,400,{ok:false,error:'canary-request-invalid'});
  try{
   const result=await prepareBranchCanary({db,sourceSha:body.sourceSha});
   return reply(res,200,{ok:true,status:'prepared',prepared:result.prepared,
    plan:result.plan,ownerGrantRequest:result.ownerGrantRequest});
  }catch{return reply(res,403,{ok:false,error:'canary-prepare-denied'});}
 }
 if(!['submit','reconcile','abandon'].includes(mode))
  return reply(res,400,{ok:false,error:'canary-mode-invalid'});
 const valid=mode==='submit'
  ?exact(body,['mode','prepared','envelope'])&&exact(body.envelope,['payload','signature'])&&
   typeof body.envelope.payload==='string'&&body.envelope.payload.length<=4096&&
   typeof body.envelope.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(body.envelope.signature)
  :exact(body,['mode','prepared','grantId'])&&GRANT.test(body.grantId||'');
 let prepared;
 try{if(!valid)throw Error();prepared=validatePreparedBranchCanary(body.prepared);}
 catch{return reply(res,400,{ok:false,error:'canary-request-invalid'});}
 let credentials,jwk;
 try{
  credentials=await appCredentials();
  if(mode==='submit')jwk=await publicJwk();
 }catch{return unconfigured(res);}
 if(mode==='reconcile'){
  try{
   const result=await reconcileBranchCanary({db,prepared,grantId:body.grantId,
    appCredentials:credentials});
   return reply(res,200,{ok:true,status:result.status,
    idempotencyKey:'ultron-task-'+prepared.taskId,
    ...(result.receipt?{receipt:result.receipt}:{}),
    ...(result.providerReadbackStatus?{providerReadbackStatus:result.providerReadbackStatus}:{}),
    ...(result.dispatched===false?{dispatched:false}:{}),
    ...(result.terminal?{terminal:true}:{})});
  }catch(error){
   if(/configuration/.test(String(error?.message)))return unconfigured(res);
   // Only fixed, non-secret reason codes; see README "Clearing reconcile_required".
   const reason=RECONCILE_REASONS.find(code=>
    String(error?.message).endsWith('github-branch-canary-'+code));
   return reply(res,202,{ok:false,status:'reconcile-required',
    idempotencyKey:'ultron-task-'+prepared.taskId,error:'provider-outcome-unresolved',
    ...(reason?{reason}:{}),
    ...(PROVIDER_STATUS[reason]?{providerReadbackStatus:PROVIDER_STATUS[reason]}:{})});
  }
 }
 if(mode==='abandon'){
  try{
   const result=await abandonBranchCanary({db,prepared,grantId:body.grantId,
    appCredentials:credentials});
   return reply(res,200,{ok:true,status:'abandoned',terminal:true,
    changed:result.changed,idempotencyKey:'ultron-task-'+prepared.taskId});
  }catch(error){
   if(/configuration/.test(String(error?.message)))return unconfigured(res);
   const reason=ABANDON_REASONS.find(code=>
    String(error?.message).endsWith('github-branch-canary-'+code));
   const conflict=/^(abandon-branch-present|abandon-state-|intent-conflict)/.test(reason||'');
   return reply(res,conflict?409:503,{ok:false,status:'abandon-refused',
    idempotencyKey:'ultron-task-'+prepared.taskId,...(reason?{reason}:{})});
  }
 }
 let result;
 try{result=await runBranchCanary({db,prepared,envelope:body.envelope,publicJwk:jwk,
  appCredentials:credentials});}
 catch(error){
  if(/configuration/.test(String(error?.message)))return unconfigured(res);
  return reply(res,400,{ok:false,error:'canary-request-invalid'});
 }
 // Never echo the signed envelope or any token-bearing value.
 const {http,...safe}=result;
 return reply(res,http,safe);
}
