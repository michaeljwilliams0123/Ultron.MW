import {db,config} from 'hatchable';
import {prepareOwnerPasskey,finishOwnerPasskey,listOwnerPasskeys}
 from 'lib/owner-passkey-enrollment.js';
export const access='admin';
export const methods=['GET','POST'];
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const held=reason=>({ok:false,status:'held',reason});
function exact(o,keys){return o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json(held('owner-identity-required'));
 if(req.method==='GET'){
  try{return res.status(200).json({ok:true,credentials:await listOwnerPasskeys({db})});}
  catch{return res.status(503).json(held('passkey-registry-unavailable'));}
 }
 if(req.method!=='POST')return res.status(405).json(held('method-not-allowed'));
 if(req.headers?.origin&&req.headers.origin!==ORIGIN)
  return res.status(403).json(held('origin-denied'));
 const b=req.body;
 try{
  let result;
  if(exact(b,['mode','request'])&&b.mode==='prepare')
   result=await prepareOwnerPasskey({db,request:b.request});
  else if(exact(b,['mode','key','envelope','attestation'])&&b.mode==='finish')
   result=await finishOwnerPasskey({db,config,key:b.key,
    envelope:b.envelope,attestation:b.attestation});
  else return res.status(400).json(held('invalid-passkey-command'));
  return res.status(result.ok?200:result.status==='reconcile-required'?503:422).json(result);
 }catch{return res.status(503).json(held('passkey-outcome-unavailable'));}
}
