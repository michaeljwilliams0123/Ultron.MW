import {db,config} from 'hatchable';
import {verifyContinuumAck,recordContinuumAck} from 'lib/continuum-ack.js';

// Authenticated bridge-only receipt intake. Public at the HTTP boundary, but
// denies unsigned, altered and stale envelopes before touching PostgreSQL.
// A receipt is NOT proof of independent Work execution or a release approval.
export const access='public';
export const methods=['POST'];
const SOURCE_KEYS=Object.freeze({
 'destiny-work':'ULTRON_CONTINUUM_DESTINY_ACK_HMAC_KEY',
 'mahoraga-cloud':'ULTRON_CONTINUUM_MAHORAGA_ACK_HMAC_KEY'
});
export default async function(req,res){
 let expectedSource;
 try{
   const raw=req.body?.raw;
   if(typeof raw!=='string'||raw.length<40||raw.length>20000)throw Error('invalid');
   expectedSource=JSON.parse(raw)?.source;
   if(!Object.hasOwn(SOURCE_KEYS,expectedSource))throw Error('invalid');
 }catch{
   return res.status(403).json({schema:'ultron.continuum-ack-intake.v1',
     ok:false,error:'receipt-not-authenticated'});
 }
 let secret;
 try{
   secret=await config.get(SOURCE_KEYS[expectedSource]);
   if(typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
     throw Error('unconfigured');
 }catch{
   return res.status(503).json({schema:'ultron.continuum-ack-intake.v1',
     ok:false,error:'receipt-bridge-unconfigured'});
 }
 let ack;
 try{
   ack=await verifyContinuumAck({
     raw:req.body?.raw,timestamp:req.body?.timestamp,
     signature:req.body?.signature,secret,expectedSource
   });
 }catch{
   return res.status(403).json({schema:'ultron.continuum-ack-intake.v1',
     ok:false,error:'receipt-not-authenticated'});
 }
 try{
   const recorded=await recordContinuumAck({db,ack});
   return res.status(recorded.created?201:200).json({
     schema:'ultron.continuum-ack-intake.v1',ok:true,
     state:'bridge-acknowledged-not-executed',
     receiptId:recorded.receiptId,created:recorded.created,
     verification:'bridge-authenticated-only'
   });
 }catch(error){
   if(error?.message==='continuum-ack-conflict')
     return res.status(409).json({schema:'ultron.continuum-ack-intake.v1',
       ok:false,error:'receipt-conflict'});
   return res.status(503).json({schema:'ultron.continuum-ack-intake.v1',
     ok:false,error:'receipt-persistence-unverified'});
 }
}
