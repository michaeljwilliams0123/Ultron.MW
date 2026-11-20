import {db} from 'hatchable';
import {readSchedulerAudit} from 'lib/scheduler-audit.js';
export const access='admin';
export const methods=['GET'];
export default async function(_req,res){
 const last24h=await readSchedulerAudit({db,windowHours:24});
 const last7d=await readSchedulerAudit({db,windowHours:168});
 return res.json({schema:'ultron.scheduler-audit.v1',last24h,last7d,
  acceptance:'not-established',
  note:'First-attempt candidates are not independent model, receipt, or release acceptance. Historical reconciliation never counts as clean acceptance.'});
}
