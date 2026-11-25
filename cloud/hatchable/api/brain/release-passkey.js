import {db,config,api} from 'hatchable';
import {prepareReleasePasskey,submitReleasePasskey} from 'lib/release-passkey.js';
import {readDeploymentReleaseReceipt} from 'lib/deployment-release-receipt/read.js';
import {createAuthenticatedGithubReleaseFetch} from 'lib/github-operator-release-fetch.js';
export const access='admin';
export const methods=['POST'];
const held=reason=>({ok:false,status:'held',reason});
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
 if(req.member?.handle!=='michaeljwilliams0123'||req.headers?.origin!=='https://ultron-mw-cloud.hatchable.site')
  return res.status(403).json(held('owner-origin-required'));
 if(req.method!=='POST')return res.status(405).json(held('method-not-allowed'));
 const b=req.body;
 try{
  const fetchGithub=createAuthenticatedGithubReleaseFetch({call:(name,args)=>api.call(name,args)});
  let r;
  if(b?.mode==='prepare'&&exact(b,['mode','request','credentialId']))r=await prepareReleasePasskey({db,config,fetchGithub,request:b.request,credentialId:b.credentialId});
  else if(b?.mode==='submit'&&exact(b,['mode','request','proof']))r=await submitReleasePasskey({db,config,fetchGithub,request:b.request,proof:b.proof});
  else if(b?.mode==='reconcile'&&exact(b,['mode','request','grantId']))r=await readDeploymentReleaseReceipt({db,request:b.request,grantId:b.grantId});
  else return res.status(422).json(held('command-invalid'));
  return res.status(r.ok?200:r.status==='reconcile-required'?503:403).json(r);
 }catch{return res.status(503).json({ok:false,status:'reconcile-required',reason:'release-passkey-unavailable'});}
}
