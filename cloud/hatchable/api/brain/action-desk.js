import {db} from 'hatchable';
import {collectActionDeskState,validDeskKeys} from 'lib/action-desk-readback.js';

export const access='admin';
export const methods=['GET'];

// A read-only observation surface. It must not mint approval or dispatch a task.
export default async function(req,res){
 res.setHeader('cache-control','private, no-store');
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({schema:'ultron.action-desk.v1',ok:false,error:'owner-required'});
 if(req.method!=='GET')
  return res.status(405).json({schema:'ultron.action-desk.v1',ok:false,error:'method-not-allowed'});
 const taskKey=req.query?.taskKey??null,actionKey=req.query?.actionKey??null;
 if(!validDeskKeys({taskKey,actionKey}))
  return res.status(400).json({schema:'ultron.action-desk.v1',ok:false,error:'action-desk-key-invalid'});
 try{return res.json(await collectActionDeskState({db,taskKey,actionKey}));}
 catch{return res.status(503).json({schema:'ultron.action-desk.v1',ok:false,error:'receipt-readback-unavailable'});}
}
