import {db} from 'hatchable';
import {readOwnerProfile,setOwnerProfile} from 'lib/owner-autonomy-control.js';
/* The platform must authenticate the owner: no token or profile can be
   supplied by the public page to mint authority. */
export const access='admin';
export const methods=['GET','POST'];
export default async function(req,res){
 if(req.method==='GET'){
  try{return res.json({ok:true,profile:await readOwnerProfile({db})});}
  catch{return res.status(503).json({ok:false,error:'autonomy-profile-unavailable'});}
 }
 try{
  const body=req.body||{};
  const r=await setOwnerProfile({db,expectedVersion:body.expectedVersion,
   preset:body.preset,allowedOperations:body.allowedOperations,
   limits:body.limits,reason:body.reason});
  return res.status(r.ok?200:409).json(r);
 }catch(error){
  const invalid=error?.message==='invalid-autonomy-profile';
  return res.status(invalid?400:503).json({ok:false,
   error:invalid?'invalid-autonomy-profile':'autonomy-profile-write-uncertain'});
 }
}
