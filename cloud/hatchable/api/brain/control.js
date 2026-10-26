import {db} from 'hatchable';
import {readExecutionControl,setExecutionControl} from 'lib/runtime-control.js';
export const access='admin';
export const methods=['GET','POST'];
export default async function(req,res){
 if(req.method==='GET'){
  try{return res.json({schema:'ultron.owner-stop.v1',ok:true,
   control:await readExecutionControl({db})});}
  catch{return res.status(503).json({schema:'ultron.owner-stop.v1',
   ok:false,error:'stop-control-unavailable'});}
 }
 try{
  const body=req.body||{};
  const result=await setExecutionControl({db,action:body.action,
   expectedVersion:body.expectedVersion,reason:body.reason});
  return res.status(result.ok?200:409).json({
   schema:'ultron.owner-stop.v1',...result});
 }catch(error){
  const invalid=error?.message==='invalid-stop-request';
  return res.status(invalid?400:503).json({schema:'ultron.owner-stop.v1',
   ok:false,error:invalid?'invalid-stop-request':'stop-control-unavailable'});
 }
}
