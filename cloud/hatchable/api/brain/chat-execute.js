import {db,config,events} from 'hatchable';
import {
 inspectPrForMerge,beginPasskeyMergeChallenge,verifyAndReservePasskeyMerge,
 executeSquashMerge,reconcileSquashMerge,validateMergeRequest
} from 'lib/chat-executor.js';

export const access='admin';
export const methods=['POST'];
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const SCHEMA='ultron.chat.executor.v1';
const HELD=reason=>({ok:false,status:'held',reason});
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));

function reply(res,code,body){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 return res.status(code).json({schema:SCHEMA,...body});
}
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
 if(req.headers?.origin!==ORIGIN)
  return reply(res,403,HELD('owner-origin-required'));
 if(req.method!=='POST')return reply(res,405,HELD('method-not-allowed'));
 const b=req.body;
 const mode=b?.mode;
 if(!['prepare','execute','reconcile'].includes(mode)||b?.operation!=='pr.merge')
  return reply(res,400,HELD('invalid-executor-request'));
 try{
  const credentials=await appCredentials();
  if(mode==='prepare'){
   if(!exact(b,['operation','mode','pullRequest','room','credentialId']))
    return reply(res,400,HELD('invalid-passkey-preparation'));
   const pr=await inspectPrForMerge({pullRequest:b.pullRequest,appCredentials:credentials});
   if(!pr.ok)return reply(res,409,pr);
   const ver=await db.query(`SELECT a.version AS profile_version,c.version AS stop_version
    FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
    WHERE a.id=1 AND a.owner='michaeljwilliams0123'`);
   const row=ver?.rows?.[0];
   if(!row)return reply(res,403,HELD('authority-state-denied'));
   const prepared={pullRequest:pr.pullRequest,headSha:pr.headSha,
    idempotencyKey:pr.idempotencyKey,room:b.room};
   const ch=await beginPasskeyMergeChallenge({db,prepared,credentialId:b.credentialId,
    expectedProfileVersion:Number(row.profile_version),
    expectedStopVersion:Number(row.stop_version)});
   return reply(res,ch.ok?200:403,{...ch,prepared,pr});
  }
  if(mode==='execute'){
   if(!exact(b,['operation','mode','prepared','proof']))
    return reply(res,400,HELD('invalid-passkey-proof'));
   const prepared=validateMergeRequest(b.prepared);
   if(!prepared)return reply(res,400,HELD('invalid-passkey-proof'));
   const approval=await verifyAndReservePasskeyMerge({db,prepared,proof:b.proof});
   if(!approval.ok)return reply(res,approval.reason==='execution-already-reserved'?409:403,approval);
   const out=await executeSquashMerge({db,prepared,
    operationDigest:approval.operationDigest,grantId:approval.grantId,
    appCredentials:credentials});
   if(out.ok&&out.messageId){
    try{await events.publish('ultron.owner','council-room',{messageId:out.messageId});}catch{}
   }
   return reply(res,out.ok?200:503,out);
  }
  if(!exact(b,['operation','mode','prepared','operationDigest','grantId']))
   return reply(res,400,HELD('invalid-reconcile-request'));
  const prepared=validateMergeRequest(b.prepared);
  if(!prepared)return reply(res,400,HELD('invalid-reconcile-request'));
  const out=await reconcileSquashMerge({db,prepared,operationDigest:b.operationDigest,
   grantId:b.grantId,appCredentials:credentials});
  if(out.ok&&out.messageId){
   try{await events.publish('ultron.owner','council-room',{messageId:out.messageId});}catch{}
  }
  return reply(res,out.ok?200:out.status==='reconcile-required'?202:409,out);
 }catch{
  return reply(res,503,HELD('chat-executor-unavailable'));
 }
}
