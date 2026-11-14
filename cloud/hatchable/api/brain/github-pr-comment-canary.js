import {db,config} from 'hatchable';
import {createHash} from 'node:crypto';
import {verifyDelegatedGrant,reservePrCommentExecution}
 from 'lib/security-adjudicator.js';
import {preparePrCommentCanary,validatePreparedCanary,canonicalCanaryComment,operationDigest,
 submitPrCommentCanary,reconcilePrCommentCanary,prCommentCanaryReadiness,
 prCommentCanaryEnabled,classifyPrCommentFailure,diagnosePrCommentCanary}
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
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,{ok:false,error:'owner-identity-required'});
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
 if(mode==='diagnose'){
  // The only provider POST here is GitHub's installation-token exchange.
  // Diagnostic mode performs repository and PR GETs, never a comment write.
  try{
   const probe=await diagnosePrCommentCanary({
    pullRequest:req.body?.pullRequest,appCredentials:await appCredentials()});
   return reply(res,200,{ok:true,status:'diagnosed',probe});
  }catch(error){
   const failure=classifyPrCommentFailure(error);
   return reply(res,503,{ok:false,status:'diagnostic-unavailable',
    reason:failure.reason});
  }
 }
 if(mode==='readback'){
  const key=req.body?.idempotencyKey,pr=req.body?.pullRequest;
  if(!req.body||Object.keys(req.body).sort().join(',')!==
     'idempotencyKey,mode,pullRequest'||
     typeof key!=='string'||!/^ultron-task-c04-pr[1-9][0-9]*-[a-f0-9]{24}$/.test(key)||
     !Number.isSafeInteger(pr)||pr<1||pr>999999999)
   return reply(res,400,{ok:false,error:'canary-request-invalid'});
  let prepared,digest;
  try{
   const result=await db.query(`SELECT idempotency_key,target_number,
    body_sha256,operation_digest,state FROM github_pr_comment_executions
    WHERE repository=$1 AND idempotency_key=$2 AND target_number=$3`,
    ['michaeljwilliams0123/Ultron.MW',key,pr]);
   const row=result?.rows?.[0];
   if(!row)return reply(res,404,{ok:false,error:'attempt-not-found'});
   if(!['in_flight','reconcile_required','completed'].includes(row.state))
    return reply(res,409,{ok:false,status:row.state,error:'attempt-not-dispatched'});
   const commentBody=canonicalCanaryComment({pullRequest:pr,idempotencyKey:key});
   const bodySha256=createHash('sha256').update(commentBody).digest('hex');
   prepared=validatePreparedCanary({pullRequest:pr,idempotencyKey:key,
    commentBody,bodySha256});
   if(bodySha256!==row.body_sha256||
      !/^[a-f0-9]{64}$/.test(row.operation_digest||''))
    return reply(res,409,{ok:false,error:'intent-conflict'});
   digest=row.operation_digest;
  }catch{return reply(res,503,{ok:false,error:'attempt-read-unavailable'});}
  try{
   const result=await reconcilePrCommentCanary({db,prepared,
    operationDigest:digest,appCredentials:await appCredentials()});
   return reply(res,200,{ok:true,status:result.status,
    idempotencyKey:key,receipt:result.receipt});
  }catch(error){
   const failure=classifyPrCommentFailure(error);
   return reply(res,202,{ok:false,status:'reconcile-required',
    idempotencyKey:key,error:'provider-outcome-unresolved',
    reason:failure.reason,stage:failure.stage});
  }
 }
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
