import {db} from 'hatchable';
import {verifyCouncilWorkerOidc} from 'lib/council-oidc.js';
import {parseBrowserWriteBody,applyBrowserWrite} from 'lib/browser-write-acceptance.js';

export const access='public';
export const methods=['POST'];
const OWNER_ORIGIN='https://ultron-mw-cloud.hatchable.site';
const reply=(res,status,body)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 return res.status(status).json({schema:'ultron.browser-write-receipt.v1',...body});
};
export default async function(req,res){
 const raw=typeof req.rawBody==='string'?req.rawBody:
  req.rawBody instanceof Uint8Array?new TextDecoder('utf8',{fatal:true}).decode(req.rawBody):null;
 if(!raw||raw.length>2000)return reply(res,400,{ok:false,reason:'browser-write-body-invalid'});
 const auth=req.headers?.authorization||req.headers?.Authorization;
 if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{250,20000}$/.test(auth))
  return reply(res,403,{ok:false,reason:'browser-write-owner-oidc-required'});
 let body,identity;
 try{
  body=parseBrowserWriteBody(raw);
  if(body.phase==='submit'&&req.headers?.origin!==OWNER_ORIGIN)
   return reply(res,403,{ok:false,reason:'browser-write-origin-denied'});
  identity=await verifyCouncilWorkerOidc({token:auth.slice(7),rawBody:raw});
 }catch{
  return reply(res,403,{ok:false,reason:'browser-write-oidc-or-contract-invalid'});
 }
 const result=await applyBrowserWrite({db,body,identity});
 return reply(res,result.status,result);
}
