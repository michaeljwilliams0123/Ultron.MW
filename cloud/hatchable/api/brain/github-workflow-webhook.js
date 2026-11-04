import {db,scheduler,webhooks,config,events} from 'hatchable';
import {validateGithubWorkflowPayload,admitGithubDelivery}
 from 'lib/hf-github-receipts.js';
import {notifyOwner} from 'lib/owner-live-events.js';

// This is GitHub's native workflow_run protocol, NOT /api/brain/events.
// The HMAC over req.rawBody is the ONLY authentication for this public ingress.
// No model, credential, external write or arbitrary task executes in this path.
export const access='public';
export const methods=['POST'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE=/^sha256=([a-f0-9]{64})$/;
function bad(res,status,error){
 return res.status(status).json({schema:'ultron.github-workflow-webhook.v1',ok:false,error});
}
function rawBytes(value){
 if(typeof value==='string')return new TextEncoder().encode(value);
 if(value instanceof Uint8Array)return value;
 return null;
}
export default async function(req,res){
 const headers=req.headers||{};
 const delivery=headers['x-github-delivery'];
 const signature=headers['x-hub-signature-256'];
 const bytes=rawBytes(req.rawBody);
 if(headers['x-github-event']!=='workflow_run'||!UUID.test(delivery||'')||
    !SIGNATURE.test(signature||'')||!bytes||bytes.length<2||bytes.length>200000)
  return bad(res,403,'event-not-authenticated');
 let secret;
 try{
  secret=await config.get('ULTRON_HF_GITHUB_WEBHOOK_SECRET');
  if(typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
   throw Error('unconfigured');
 }catch{return bad(res,503,'github-hook-not-configured');}
 let verified=false;
 try{
  verified=await webhooks.verifyHmac({
   raw:req.rawBody,signature:signature.slice(7),secret,algorithm:'sha256',
   encoding:'hex'
  });
 }catch{}
 if(!verified)return bad(res,403,'event-not-authenticated');
 let event;
 try{event=validateGithubWorkflowPayload(req.body);}
 catch{return bad(res,422,'unsupported-workflow-receipt');}
 let digest;
 try{
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  digest=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
 }catch{return bad(res,503,'digest-unavailable');}
 let receipt;
 try{receipt=await admitGithubDelivery({
  db,deliveryId:delivery,event,payloadSha256:digest});}
 catch(e){
  return bad(res,e?.message==='delivery-id-conflict'?409:503,
   e?.message==='delivery-id-conflict'?'delivery-id-conflict':'receipt-unavailable');
 }
 let scheduled=false;
 if(receipt.created){
  try{await scheduler.now('/api/brain/hf-github-reconcile',{via:'verified-github-delivery'});scheduled=true}
  catch{scheduled=false}
  await notifyOwner(events,'github');
 }
 return res.status(receipt.created?202:200).json({
  schema:'ultron.github-workflow-webhook.v1',ok:true,
  status:receipt.created?'committed-awaiting-provider-reconciliation':'duplicate',
  runId:receipt.runId,scheduled,
  // Raw signatures, event contents, hashed keys and secrets are never echoed.
 });
}
