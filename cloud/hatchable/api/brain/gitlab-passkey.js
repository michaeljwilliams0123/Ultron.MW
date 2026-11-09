import {db,config,api} from 'hatchable';
import {gitlabBranchWrite} from 'lib/gitlab-branch-write.js';
import {startOwnerPasskeyChallenge} from 'lib/owner-passkey-authorization.js';
export const access='admin';
export const methods=['POST'];
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const held=reason=>({ok:false,status:'held',reason});
function exact(o,keys){return o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');}
function validRequest(r){
 return exact(r,['key','sourceSha','expectedProfileVersion','expectedStopVersion'])&&
 typeof r.key==='string'&&/^[a-z0-9-]{8,48}$/.test(r.key)&&
 typeof r.sourceSha==='string'&&/^[a-f0-9]{40}$/.test(r.sourceSha)&&
 Number.isSafeInteger(r.expectedProfileVersion)&&r.expectedProfileVersion>0&&
 Number.isSafeInteger(r.expectedStopVersion)&&r.expectedStopVersion>0;
}
function validProof(p){
 return exact(p,['grantId','credentialId','authenticatorData','clientDataJSON','signature'])&&
 typeof p.grantId==='string'&&/^passkey-[A-Za-z0-9-]{16,96}$/.test(p.grantId)&&
 ['credentialId','authenticatorData','clientDataJSON','signature'].every(k=>
  typeof p[k]==='string'&&p[k].length>=16&&p[k].length<=8192);
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json(held('owner-identity-required'));
 if(req.headers?.origin&&req.headers.origin!==ORIGIN)
  return res.status(403).json(held('origin-denied'));
 if(req.method!=='POST')return res.status(405).json(held('method-not-allowed'));
 const b=req.body;
 if(!b||!validRequest(b.request))return res.status(400).json(held('invalid-passkey-command'));
 try{
  let result;
  if(b.mode==='prepare'&&exact(b,['mode','request','credentialId'])){
   const prepared=await gitlabBranchWrite({mode:'prepare',request:b.request});
   if(!prepared.ok)return res.status(422).json(prepared);
   result=await startOwnerPasskeyChallenge({db,grantRequest:prepared.grantRequest,
    credentialId:b.credentialId});
  }else if(b.mode==='submit'&&exact(b,['mode','request','proof'])&&validProof(b.proof)){
   result=await gitlabBranchWrite({mode:'submit',request:b.request,passkey:b.proof,
    db,config,api});
  }else if(b.mode==='reconcile'&&exact(b,['mode','request','grantId'])&&
   typeof b.grantId==='string'&&/^passkey-[A-Za-z0-9-]{16,96}$/.test(b.grantId)){
   result=await gitlabBranchWrite({mode:'reconcile',request:b.request,grantId:b.grantId,
    db,api});
  }else return res.status(400).json(held('invalid-passkey-command'));
  const code=result.status==='observed'||result.ok?200:
   result.status==='reconcile-required'?503:result.reason?.includes('conflict')?409:422;
  // Return only provider-receipt metadata, never raw assertions or secrets.
  if(b.mode!=='prepare'){
   const {ok,status,reason,branch,url,key,evidence}=result;
   return res.status(code).json({ok:ok===true,status,
    ...(reason?{reason}:{}),...(branch?{branch}:{}),
    ...(url?{url}:{}),...(key?{key}:{}),...(evidence?{evidence}:{})});
  }
  return res.status(code).json(result);
 }catch{return res.status(503).json({ok:false,status:'reconcile-required',
  reason:'provider-outcome-unresolved'});}
}
