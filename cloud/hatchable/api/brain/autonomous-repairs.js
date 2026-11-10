import {db} from 'hatchable';
import {listRepairStatuses,getRepairStatus} from 'lib/autonomous-repair-status.js';

// Hatchable must enforce the current authenticated project administrator.
// This endpoint cannot create, resume, retry, commit, publish or merge writes.
export const access='admin';
export const methods=['GET'];

const response=(res,status,body)=>res.status(status).json({
 schema:'ultron.autonomous-repairs.status.v1',...body
});
export default async function handler(req,res){
 const query=req.query??{};
 try{
  if(query.id!==undefined){
   if(typeof query.id!=='string'||query.id.length>80)
    return response(res,422,{ok:false,error:'repair-id-invalid'});
   const item=await getRepairStatus({db,id:query.id});
   return item?response(res,200,{ok:true,item,observedAt:new Date().toISOString()}):
    response(res,404,{ok:false,error:'repair-not-found'});
  }
  const raw=query.limit??'25';
  if(typeof raw!=='string'||!/^([1-9]|[1-4][0-9]|50)$/.test(raw))
   return response(res,422,{ok:false,error:'limit-invalid'});
  const items=await listRepairStatuses({db,limit:Number(raw)});
  return response(res,200,{ok:true,items,observedAt:new Date().toISOString()});
 }catch{
  // DB/migration unavailability is not an empty inventory.
  return response(res,503,{ok:false,error:'repair-status-unavailable'});
 }
}
