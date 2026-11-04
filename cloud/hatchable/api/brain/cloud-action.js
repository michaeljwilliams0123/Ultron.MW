import {db,events} from 'hatchable';
import {notifyOwner} from 'lib/owner-live-events.js';
import {executeCloudNote} from 'lib/cloud-native-action.js';

export const access='admin';
export const methods=['POST'];
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({schema:'ultron.cloud-action.v1',
   ok:false,status:'held',reason:'owner-identity-required'});
 const result=await executeCloudNote({db,request:req.body});
 const status=result.status==='completed'?result.reused?200:201:
  result.status==='reconcile-required'?503:
  result.reason==='idempotency-conflict'?409:
  result.reason==='owner-profile-or-stop-denied'?403:400;
 if(result.status==='completed'&&!result.reused)await notifyOwner(events,'note');
 return res.status(status).json({schema:'ultron.cloud-action.v1',
  ok:result.status==='completed',...result});
}
