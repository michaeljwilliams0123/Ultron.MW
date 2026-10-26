import {db,config} from 'hatchable';
import {verifyDelegatedGrant,consumeDelegatedGrant} from 'lib/security-adjudicator.js';

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
 try{
  const verified=await verifyDelegatedGrant({
   envelope:req.body?.envelope,request:req.body?.request,publicJwk
  });
  const result=await consumeDelegatedGrant({db,verifiedGrant:verified});
  if(!result.ok)return res.status(result.error==='grant-replayed'?409:403).json({
   schema:'ultron.authority-admission.v1',ok:false,error:result.error
  });
  // Never return the signed grant payload or token-bearing request.
  return res.status(201).json({
   schema:'ultron.authority-admission.v1',ok:true,
   grantId:result.grantId,receiptId:result.receiptId,status:'admitted-not-executed'
  });
 }catch{
  return res.status(403).json({schema:'ultron.authority-admission.v1',
   ok:false,error:'authority-not-verified'});
 }
}
