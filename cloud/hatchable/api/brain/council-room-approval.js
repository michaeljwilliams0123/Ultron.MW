import {db,events} from 'hatchable';
import {recordApprovalDecision} from 'lib/council-front-door.js';

export const access='admin';
export const methods=['POST'];

// The owner's click on an in-thread approval card. This records a decision
// only; it never executes the operation, and chat text cannot reach it.
export default async function(req,res){
 res.setHeader('cache-control','private, no-store');
 if(req.method!=='POST')
  return res.status(405).json({schema:'ultron.council-room.approval.v1',ok:false,error:'method-not-allowed'});
 const site=req.headers?.['sec-fetch-site'];
 if(site&&site!=='same-origin')
  return res.status(403).json({schema:'ultron.council-room.approval.v1',ok:false,error:'same-origin-required'});
 const out=await recordApprovalDecision(db,{memberHandle:req.member?.handle,
  taskId:req.body?.taskId,cardId:String(req.body?.cardId||''),choice:req.body?.choice});
 const {status,...body}=out;
 if(out.ok&&status===201){try{await events.publish('ultron.owner','council-room',{approval:out.decision.cardId})}catch{}}
 return res.status(status).json({schema:'ultron.council-room.approval.v1',...body});
}
