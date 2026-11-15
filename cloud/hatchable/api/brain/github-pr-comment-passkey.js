import {db,config} from 'hatchable';
import {validatePreparedCanary,prCommentCanaryReadiness,
 prCommentCanaryEnabled,submitPrCommentCanary,classifyPrCommentFailure}
 from 'lib/github-pr-comment-canary.js';
import {beginC04PasskeyChallenge,verifyAndReserveC04Passkey}
 from 'lib/c04-passkey-comment.js';
export const access='admin';
export const methods=['POST'];
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const SCHEMA='ultron.c04.owner-webauthn-comment.v1';
const HELD=reason=>({ok:false,status:'held',reason});
function reply(res,code,body){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 return res.status(code).json({schema:SCHEMA,...body});
}
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');
async function appCredentials(){
 const [appId,installationId,privateKey]=await Promise.all([
  config.get('ULTRON_GITHUB_APP_ID'),config.get('ULTRON_GITHUB_INSTALLATION_ID'),
  config.get('ULTRON_GITHUB_APP_PRIVATE_KEY')]);
 if(String(appId)!=='5633654'||String(installationId)!=='179066535'||
  typeof privateKey!=='string'||!privateKey.includes('PRIVATE KEY'))
  throw Error('app-configuration-unavailable');
 return {appId,installationId,privateKey};
}
export default async function handler(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,HELD('owner-identity-required'));
 // Strict same-origin POST: never accept cross-site CSRF or arbitrary admin callers.
 if(req.headers?.origin!==ORIGIN)
  return reply(res,403,HELD('owner-origin-required'));
 if(req.method!=='POST')return reply(res,405,HELD('method-not-allowed'));
 const b=req.body;
 const mode=b?.mode;
 if(mode!=='prepare'&&mode!=='submit')
  return reply(res,400,HELD('invalid-mode'));
 try{
  const readConfig=name=>config.get(name);
  if(!await prCommentCanaryEnabled(readConfig))
   return reply(res,503,HELD('canary-disabled'));
  const ready=await prCommentCanaryReadiness({db,readConfig});
  if(!ready.enabled||!ready.configured)
   return reply(res,503,HELD('canary-not-configured'));
  if(mode==='prepare'){
   if(!exact(b,['mode','prepared','credentialId',
      'expectedProfileVersion','expectedStopVersion']))
    return reply(res,400,HELD('invalid-passkey-preparation'));
   const result=await beginC04PasskeyChallenge({db,prepared:b.prepared,
    credentialId:b.credentialId,expectedProfileVersion:b.expectedProfileVersion,
    expectedStopVersion:b.expectedStopVersion});
   return reply(res,result.ok?200:403,result);
  }
  if(!exact(b,['mode','prepared','proof']))
   return reply(res,400,HELD('invalid-passkey-proof'));
  let prepared;
  try{prepared=validatePreparedCanary(b.prepared);}
  catch{return reply(res,400,HELD('invalid-passkey-proof'));}
  // Fail before consuming the five-minute assertion if App custody broke.
  const credentials=await appCredentials();
  const approval=await verifyAndReserveC04Passkey({db,prepared,proof:b.proof});
  if(!approval.ok)return reply(res,
   approval.reason==='execution-already-reserved'?409:403,approval);
  try{
   const result=await submitPrCommentCanary({db,prepared,
    operationDigest:approval.operationDigest,appCredentials:credentials});
   return reply(res,201,{ok:true,status:result.status,
    idempotencyKey:prepared.idempotencyKey,receipt:result.receipt});
  }catch(error){
   const failure=classifyPrCommentFailure(error);
   if(failure.dispatched===false)
    return reply(res,503,{ok:false,status:'reserved',
     idempotencyKey:prepared.idempotencyKey,reason:failure.reason,dispatched:false});
   return reply(res,202,{ok:false,status:'reconcile-required',
    idempotencyKey:prepared.idempotencyKey,
    reason:failure.reason,stage:failure.stage,dispatched:null});
  }
 }catch{return reply(res,503,HELD('owner-passkey-canary-unavailable'));}
}
