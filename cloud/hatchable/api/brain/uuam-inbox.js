import {db,config} from 'hatchable';
import {verifyUuamDelivery,persistUuamDelivery} from 'lib/uuam-inbox.js';

// Cloudflare-only signed staging intake. Public URL; HMAC is the authentication.
// No owner grant, Council approval, token mint or GitHub write occurs here.
export const access='public';
export const methods=['POST'];

const SCHEMA='ultron.uuam.hatchable-inbox.v1';
const reply=(res,status,error)=>res.status(status).json({
 schema:SCHEMA,ok:false,error
});
export default async function(req,res){
 if(req.headers?.['x-ultron-environment']!=='staging')
   return reply(res,403,'staging-only');
 let enabled,secret;
 try{
   enabled=await config.get('ULTRON_UUAM_INBOX_ENABLED');
   if(enabled!=='true')throw Error('disabled');
   secret=await config.get('ULTRON_UUAM_DELIVERY_HMAC_KEY');
   if(typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
     throw Error('missing-secret');
 }catch{
   return reply(res,503,'inbox-not-configured');
 }
 let delivery;
 try{
   delivery=await verifyUuamDelivery({
     raw:req.rawBody,
     timestamp:req.headers?.['x-ultron-timestamp'],
     signature:req.headers?.['x-ultron-signature'],
     secret
   });
   if(req.headers?.['x-ultron-delivery-id']!==delivery.deliveryId)
     throw Error('delivery-header-mismatch');
 }catch{
   return reply(res,401,'delivery-not-authenticated');
 }
 try{
   const receipt=await persistUuamDelivery({db,delivery});
   return res.status(receipt.status==='persisted'?201:200).json({
     schema:SCHEMA,ok:true,status:receipt.status,
     deliveryId:receipt.deliveryId,
     payloadSha256:receipt.payloadSha256,
     authorization:'not-authorized',
     execution:'not-executed'
   });
 }catch(e){
   if(e?.message==='uuam-inbox-conflict')
     return reply(res,409,'idempotency-conflict');
   // Missing 0047, uncertain commit, downtime: retry, never acknowledge.
   return reply(res,503,'persistence-not-verified');
 }
}
