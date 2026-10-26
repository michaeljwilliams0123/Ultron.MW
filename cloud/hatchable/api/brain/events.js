import {db,scheduler,config} from 'hatchable';
import {verifySignedEvent,admitSignedEvent} from 'lib/signed-event-inbox.js';

// This public endpoint is exclusively for HMAC-authenticated event-bridge
// envelopes, NOT direct unsigned GitHub webhook bodies. It never executes
// an external write: admission queues only bounded read/advisory objectives.
export const access='public';
export const methods=['POST'];
export default async function(req,res){
 let secret;
 try{
  secret=await config.get('ULTRON_EVENT_BRIDGE_HMAC_KEY');
  if(typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
   throw Error('event-key-unavailable');
 }catch{
  return res.status(503).json({schema:'ultron.signed-event-admission.v1',
   ok:false,error:'event-bridge-unconfigured'});
 }
 let event;
 try{
  event=await verifySignedEvent({raw:req.body?.raw,
   timestamp:req.body?.timestamp,signature:req.body?.signature,secret});
 }catch{
  return res.status(403).json({schema:'ultron.signed-event-admission.v1',
   ok:false,error:'event-not-verified'});
 }
 try{
  const admitted=await admitSignedEvent({db,scheduler,event});
  if(!admitted.ok)return res.status(admitted.error==='queue-full'?429:409).json({
   schema:'ultron.signed-event-admission.v1',ok:false,error:admitted.error
  });
  return res.status(admitted.created?202:200).json({
   schema:'ultron.signed-event-admission.v1',ok:true,
   status:admitted.created?'admitted-not-executed':'duplicate-delivery',
   ...(admitted.created?{taskId:admitted.taskId}:{}),
   immediateScheduled:admitted.immediateScheduled===true
  });
 }catch(error){
  if(error?.message==='delivery-id-conflict')
   return res.status(409).json({schema:'ultron.signed-event-admission.v1',
    ok:false,error:'delivery-id-conflict'});
  return res.status(503).json({schema:'ultron.signed-event-admission.v1',
   ok:false,error:'event-admission-unavailable'});
 }
}
