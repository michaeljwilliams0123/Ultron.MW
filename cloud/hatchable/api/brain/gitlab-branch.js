import {db,config,api} from 'hatchable';
import {gitlabBranchWrite} from 'lib/gitlab-branch-write.js';

// Cloud-first owner command transport for the *same* signed provider engine
// that backs native MCP. No private keys or credentials enter this module.
export const access='admin';
export const methods=['POST'];
const OWNER='michaeljwilliams0123';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
const KEY=/^[a-z0-9-]{8,48}$/;
const SHA=/^[a-f0-9]{40}$/;
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;

function exact(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 let keys;
 try{
  const fieldsFound=Object.getOwnPropertyDescriptors(value);
  keys=Reflect.ownKeys(fieldsFound);
  if(keys.some(k=>typeof k!=='string'||!fieldsFound[k].enumerable||
     !Object.hasOwn(fieldsFound[k],'value')))return false;
 }catch{return false;}
 return keys.length===fields.length&&
  fields.every(k=>Object.hasOwn(value,k));
}
function validated(body){
 if(!exact(body,body?.mode==='prepare'?['mode','request']:
   body?.mode==='submit'?['mode','request','envelope']:
   body?.mode==='reconcile'?['mode','request','grantId']:[]))return null;
 const request=body.request;
 if(!exact(request,['key','sourceSha','expectedProfileVersion','expectedStopVersion'])||
   typeof request.key!=='string'||!KEY.test(request.key)||
   typeof request.sourceSha!=='string'||!SHA.test(request.sourceSha)||
   !Number.isSafeInteger(request.expectedProfileVersion)||request.expectedProfileVersion<1||
   !Number.isSafeInteger(request.expectedStopVersion)||request.expectedStopVersion<1)
  return null;
 if(body.mode==='submit'){
  if(!exact(body.envelope,['payload','signature'])||
   typeof body.envelope.payload!=='string'||!body.envelope.payload||
   body.envelope.payload.length>4096||
   typeof body.envelope.signature!=='string'||
   !/^[A-Za-z0-9_-]{86}$/.test(body.envelope.signature))
   return null;
 }
 if(body.mode==='reconcile'&&(typeof body.grantId!=='string'||
    !GRANT.test(body.grantId)))return null;
 return {mode:body.mode,request,
  ...(body.mode==='submit'?{envelope:body.envelope}:{}),
  ...(body.mode==='reconcile'?{grantId:body.grantId}:{})};
}

function httpStatus(mode,result){
 if(result?.status==='observed')return 200;
 if(result?.status==='reconcile-required')return 503;
 if(result?.status==='held'){
  if(result.reason==='idempotency-conflict'||result.reason==='grant-conflict'||
     result.reason==='gitlab-branch-already-exists')return 409;
  if(result.reason==='adjudicator-unconfigured'||
     result.reason==='authority-or-ledger-unavailable'||
     result.reason==='gitlab-write-oauth-required')return 503;
  if(result.reason?.startsWith('grant-'))return 403;
  return 422;
 }
 return mode==='prepare'&&result?.ok===true?200:
   result?.ok===true?200:503;
}

export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)return res.status(403).json(held('owner-identity-required'));
 // Cross-origin browser POSTs never acquire provider write authority.
 const origin=req.headers?.origin;
 if(origin&&origin!==ORIGIN)return res.status(403).json(held('origin-denied'));
 if(req.method!=='POST')return res.status(405).json(held('method-not-allowed'));
 const input=validated(req.body);
 if(!input)return res.status(400).json(held('invalid-cloud-write-request'));
 let result;
 try{result=await gitlabBranchWrite({...input,db,config,api});}
 catch{
  // An exception may follow a committed effect. Never attempt a second POST.
  return res.status(503).json(uncertain('provider-outcome-unresolved'));
 }
 const code=httpStatus(input.mode,result);
 if(input.mode==='prepare'){
  if(code!==200)return res.status(code).json({...result,mode:'prepare'});
  return res.status(200).json({ok:true,mode:'prepare',grantRequest:result.grantRequest});
 }
 // Return only non-secret receipt fields; never echo signed payloads.
 if(!result||typeof result!=='object')
  return res.status(503).json(uncertain('provider-outcome-unresolved'));
 const {ok,status,reason,branch,url,key,evidence}=result;
 return res.status(code).json({ok:ok===true,status,operation:'gitlab.branch.create',
  ...(reason?{reason}:{}),...(branch?{branch}:{}),...(url?{url}:{}),
  ...(key?{key}:{}),...(evidence?{evidence}:{})});
}
