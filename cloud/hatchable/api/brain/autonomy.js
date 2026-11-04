import {db,events} from 'hatchable';
import {notifyOwner} from 'lib/owner-live-events.js';
import {readOwnerProfile,setOwnerProfile} from 'lib/owner-autonomy-control.js';
/* The platform must authenticate the owner: no token or profile can be
   supplied by the public page to mint authority. */
export const access='admin';
export const methods=['GET','POST'];
const REQUEST_KEYS=new Set(['expectedVersion','preset','allowedOperations','limits','reason']);
function strictOwnerRequest(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 let descriptors;
 try{descriptors=Object.getOwnPropertyDescriptors(raw);}
 catch{return null;}
 const keys=Reflect.ownKeys(descriptors);
 if(keys.length<1||keys.length>REQUEST_KEYS.size)return null;
 const body=Object.create(null);
 for(const key of keys){
  const d=descriptors[key];
  if(typeof key!=='string'||!REQUEST_KEYS.has(key)||!d?.enumerable||
     !Object.prototype.hasOwnProperty.call(d,'value'))return null;
  body[key]=d.value;
 }
 return body;
}
export default async function(req,res){
 if(req.method==='GET'){
  try{return res.json({ok:true,profile:await readOwnerProfile({db})});}
  catch{return res.status(503).json({ok:false,error:'autonomy-profile-unavailable'});}
 }
 try{
  // Reject unknown admin fields instead of silently discarding them and
  // incrementing the profile version (observed in live C18 negative canary).
  const body=strictOwnerRequest(req.body);
  if(!body)return res.status(400).json({ok:false,error:'invalid-autonomy-profile'});
  const r=await setOwnerProfile({db,expectedVersion:body.expectedVersion,
   preset:body.preset,allowedOperations:body.allowedOperations,
   limits:body.limits,reason:body.reason});
  if(r.ok)await notifyOwner(events,'profile');
  return res.status(r.ok?200:409).json(r);
 }catch(error){
  const invalid=error?.message==='invalid-autonomy-profile';
  return res.status(invalid?400:503).json({ok:false,
   error:invalid?'invalid-autonomy-profile':'autonomy-profile-write-uncertain'});
 }
}
