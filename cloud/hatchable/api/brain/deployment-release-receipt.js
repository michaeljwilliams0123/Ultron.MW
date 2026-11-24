import {db,config,api} from 'hatchable';
import {createAuthenticatedGithubReleaseFetch} from 'lib/github-operator-release-fetch.js';
import {
 prepareDeploymentReleaseReceipt,submitDeploymentReleaseReceipt,
 readDeploymentReleaseReceipt
} from 'lib/deployment-release-receipt.js';

export const access='admin';
export const methods=['POST'];
const OWNER='michaeljwilliams0123';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const exact=(value,fields)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return false;
 try{
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  return keys.length===fields.length&&keys.every(key=>typeof key==='string'&&
   fields.includes(key)&&descriptors[key].enumerable&&
   Object.hasOwn(descriptors[key],'value'));
 }catch{return false;}
};
const fail=(reason,status='held')=>({schema:'ultron.deployment-release-receipt.v1',
 ok:false,status,reason});

export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)return res.status(403).json(fail('owner-identity-required'));
 if(req.headers?.origin&&req.headers.origin!==ORIGIN)
  return res.status(403).json(fail('origin-denied'));
 if(req.method!=='POST')return res.status(405).json(fail('method-not-allowed'));
 const body=req.body;
 if(!body||!['prepare','submit','reconcile'].includes(body.mode))
  return res.status(422).json(fail('command-invalid'));
 const fields=body.mode==='prepare'?['mode','request']:
  body.mode==='submit'?['mode','request','envelope']:['mode','request','grantId'];
 if(!exact(body,fields))return res.status(422).json(fail('command-invalid'));
 let result;
 try{
  if(body.mode==='prepare')result=await prepareDeploymentReleaseReceipt({db,request:body.request});
  else if(body.mode==='submit')result=await submitDeploymentReleaseReceipt({
   db,config,request:body.request,envelope:body.envelope,
   fetchGithub:createAuthenticatedGithubReleaseFetch({call:(name,args)=>api.call(name,args)})});
  else result=await readDeploymentReleaseReceipt({
   db,request:body.request,grantId:body.grantId});
 }catch{return res.status(503).json(fail('receipt-outcome-unresolved','reconcile-required'));}
 const response={schema:'ultron.deployment-release-receipt.v1',...result};
 if(result.ok&&['prepared','observed'].includes(result.status))return res.status(200).json(response);
 if(result.status==='reconcile-required')return res.status(503).json(response);
 if(result.reason?.includes('conflict'))return res.status(409).json(response);
 if(result.reason?.includes('grant')||result.reason==='authority-denied')
  return res.status(403).json(response);
 return res.status(422).json(response);
}
