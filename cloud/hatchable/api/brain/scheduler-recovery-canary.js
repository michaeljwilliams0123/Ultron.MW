import {db,scheduler} from 'hatchable';
import {recoverMissedHours} from 'lib/scheduler-recovery.js';
export const access='admin';
export const methods=['POST'];
const KEY=/^[a-z0-9](?:[a-z0-9-]{6,46}[a-z0-9])$/;
export default async function(req,res){
 const key=typeof req.body?.key==='string'?req.body.key:'';
 if(!KEY.test(key))return res.status(422).json({error:'recovery-canary-key-invalid'});
 const recovery=await recoverMissedHours({db,now:new Date(),lookbackHours:1,
  keyPrefix:'recovery-canary-'+key+'-'});
 let continuation_scheduled=false;
 if(recovery.recoveredCount>0){
  try{
   await scheduler.now('/api/brain/run',{via:'scheduler-recovery-live-canary'});
   continuation_scheduled=true;
  }catch{continuation_scheduled=false;}
 }
 return res.json({canary:true,scheduled_count:recovery.recoveredCount,
  recovery_window_hours:recovery.windowHours,
  receipt_event_type:recovery.receiptEventType,
  evidence_class:recovery.evidenceClass,continuation_scheduled,
  mode:'explicit-live-canary-not-slo'});
}
