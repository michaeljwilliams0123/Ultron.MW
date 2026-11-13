import {db,config} from 'hatchable';
import {verifyDelegatedGrant,reservePrCommentExecution}
 from 'lib/security-adjudicator.js';
import {preparePrCommentCanary,validatePreparedCanary,operationDigest,
 submitPrCommentCanary,reconcilePrCommentCanary,prCommentCanaryReadiness,
 prCommentCanaryEnabled,classifyPrCommentFailure}
 from 'lib/github-pr-comment-canary.js';

export const access='admin';
export const methods=['POST'];
const SCHEMA='ultron.github.pr-comment-canary.v1';
function reply(res,status,value){
 res.setHeader('Cache-Control','private, no-store');
 return res.status(status).json({schema:SCHEMA,...value});
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
function grantRequest(prepared){
 return {actor:'worker:coordinator',objectiveId:prepared.idempotencyKey,
  operation:'pr.comment',
  resource:`github:pr-comment:michaeljwilliams0123/Ultron.MW:${prepared.pullRequest}:sha256:${prepared.bodySha256}`,
  administrativeChange:false};
}
function grantId(envelope){
 try{
  const value=JSON.parse(envelope?.payload);
  if(typeof value?.grantId!=='string'||value.grantId.length<8)throw Error();
  return value.grantId;
 }catch{throw Error('envelope');}
}
function notConfigured(res,readiness){
 return reply(res,503,{ok:false,status:'not-configured',
  error:'canary-not-configured',missing:readiness.missing});
}
function disabled(res){
 return reply(res,503,{ok:false,status:'disabled',error:'canary-disabled',
  reason:'canary-disabled'});
}
export default async function handler(req,res){
 const mode=req.body?.mode;
 const readConfig=name=>config.get(name);
 if(mode==='status'){
  let readiness;
  try{readiness=await prCommentCanaryReadiness({db,readConfig});}
  catch{readiness={enabled:false,prerequisitesReady:false,configured:false,
   status:'disabled',reason:'canary-disabled',missing:['readiness-unavailable']};}
  return reply(res,200,{ok:true,status:readiness.status,
   configured:readiness.configured,enabled:readiness.enabled,
   reason:readiness.reason,prerequisitesReady:readiness.prerequisitesReady,
   missing:readiness.missing});
 }
 // Kill switch first: while disabled no other mode reads the ledger,
 // reserves, exchanges tokens or calls GitHub.
 if(!(await prCommentCanaryEnabled(readConfig)))return disabled(res);
 let readiness;
 try{readiness=await prCommentCanaryReadiness({db,readConfig});}
 catch{readiness={configured:false,status:'not-configured',missing:['readiness-unavailable']};}
 if(!readiness.enabled)return disabled(res);
 if(!readiness.configured)return notConfigured(res,readiness);
 if(mode==='prepare'){
  try{
   const prepared=await preparePrCommentCanary({db,
    pullRequest:req.body?.pullRequest});
   return reply(res,200,{ok:true,status:'prepared',prepared:{
    pullRequest:prepared.pullRequest,idempotencyKey:prepared.idempotencyKey,
    commentBody:prepared.commentBody,bodySha256:prepared.bodySha256},
    ownerGrantRequest:prepared.ownerGrantRequest});
  }catch{return reply(res,403,{ok:false,error:'canary-prepare-denied'});}
 }
 let prepared;
 try{prepared=validatePreparedCanary(req.body?.prepared);}
 catch{return reply(res,400,{ok:false,error:'canary-request-invalid'});}
 if(mode==='reconcile'){
  let digest;
  try{digest=operationDigest(prepared,grantId(req.body?.envelope));}
  catch{return reply(res,400,{ok:false,error:'canary-envelope-invalid'});}
  try{
   const result=await reconcilePrCommentCanary({db,prepared,
    operationDigest:digest,appCredentials:await appCredentials()});
   return reply(res,200,{ok:true,status:result.status,
    idempotencyKey:prepared.idempotencyKey,receipt:result.receipt});
  }catch(error){
   const failure=classifyPrCommentFailure(error);
   return reply(res,202,{ok:false,status:'reconcile-required',
    idempotencyKey:prepared.idempotencyKey,error:'provider-outcome-unresolved',
    reason:failure.reason,stage:failure.stage});
  }
 }
 if(mode!=='submit')return reply(res,400,{ok:false,error:'canary-mode-invalid'});
 let credentials,jwk,verified,digest;
 try{
  [credentials,jwk]=await Promise.all([appCredentials(),publicJwk()]);
  verified=await verifyDelegatedGrant({envelope:req.body?.envelope,
   request:grantRequest(prepared),publicJwk:jwk});
  digest=operationDigest(prepared,verified.grantId);
 }catch(error){
  return reply(res,error?.message==='configuration'?503:403,{ok:false,
   error:error?.message==='configuration'?'canary-configuration-incomplete':
    'authority-not-verified'});
 }
 let reservation;
 try{reservation=await reservePrCommentExecution({db,verifiedGrant:verified,
  idempotencyKey:prepared.idempotencyKey,pullRequest:prepared.pullRequest,
  bodySha256:prepared.bodySha256,operationDigest:digest});}
 catch{return reply(res,503,{ok:false,error:'canary-reservation-unavailable'});}
 if(!reservation.ok)return reply(res,reservation.error==='execution-already-reserved'?409:403,
  {ok:false,error:reservation.error,status:reservation.status});
 try{
  const result=await submitPrCommentCanary({db,prepared,
   operationDigest:digest,appCredentials:credentials});
  return reply(res,201,{ok:true,status:result.status,
   idempotencyKey:prepared.idempotencyKey,receipt:result.receipt});
 }catch(error){
  // Never echo the raw exception: it can contain provider payloads or secrets.
  // A pre-dispatch failure is distinguishable from an ambiguous remote effect.
  const failure=classifyPrCommentFailure(error);
  if(failure.dispatched===false)
   return reply(res,503,{ok:false,status:'reserved',
    idempotencyKey:prepared.idempotencyKey,error:'canary-dispatch-unavailable',
    reason:failure.reason,stage:failure.stage,dispatched:false});
  return reply(res,202,{ok:false,status:'reconcile-required',
   idempotencyKey:prepared.idempotencyKey,error:'provider-outcome-unresolved',
   reason:failure.reason,stage:failure.stage,dispatched:null,
   ...(failure.providerHttpStatus?{providerHttpStatus:failure.providerHttpStatus}:{})});
 }
}
