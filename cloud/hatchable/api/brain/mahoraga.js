import { db,config } from 'hatchable';
import { runMahoragaAction,mahoragaActionStatus } from 'lib/mahoraga-actions.js';
export const access='admin';
export const methods=['GET','POST'];
export default async function(req,res){
 if(req.method==='GET'){
   const result=await mahoragaActionStatus({db},req.query?.key);
   return res.status(result.ok?200:404).json(result);
 }
 const result=await runMahoragaAction({db,config},req.body);
 return res.status(result.ok?(result.state==='observed'?200:202):
   result.error==='idempotency-key-conflict'?409:400).json(result);
}
