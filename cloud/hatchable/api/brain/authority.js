import {db,config} from 'hatchable';
import {verifyDelegatedGrant,consumeDelegatedGrant} from 'lib/security-adjudicator.js';
// #412: these operations have their own atomic reservation route
// (github-pr-comment-canary / github-branch-canary) and are refused here.
const DEDICATED=new Set(['pr.comment','repair.branch.create']);

// Owner-only admission API. It checks and records signed authority but does
// NOT execute the requested operation or mint administrative credentials.
export const access='admin';
export const methods=['POST'];
export default async function(req,res){
 let publicJwk;
 try{
  const encoded=await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK');
  if(typeof encoded!=='string'||encoded.length<20||encoded.length>4096)
   throw Error('missing-trusted-key');
  publicJwk=JSON.parse(encoded);
 }catch{
  return res.status(503).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'adjudicator-unconfigured'});
 }
 if(DEDICATED.has(req.body?.request?.operation))
  return res.status(403).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'operation-requires-dedicated-route'});
 let verified;
 try{
  verified=await verifyDelegatedGrant({
   envelope:req.body?.envelope,request:req.body?.request,publicJwk
  });
 }catch{
  return res.status(403).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'authority-not-verified'});
 }
 if(DEDICATED.has(verified?.operation))
  return res.status(403).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'operation-requires-dedicated-route'});
 try{
  const result=await consumeDelegatedGrant({db,verifiedGrant:verified});
  if(!result.ok)return res.status(result.error==='grant-replayed'?409:403).json({
   schema:'ultron.authority-admission.v1',ok:false,error:result.error
  });
  // Never return the signed grant payload or token-bearing request.
  return res.status(201).json({
   schema:'ultron.authority-admission.v1',ok:true,
   grantId:result.grantId,receiptId:result.receiptId,status:'admitted-not-executed'
  });
 }catch(error){
  // Log only the trusted short grant ID and error category, never signed data.
  console.warn('authority-ledger-unavailable:'+verified.grantId+':'+
   String(error?.code||'driver-failure').slice(0,24));
  return res.status(503).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'authority-ledger-unavailable'});
 }
}
