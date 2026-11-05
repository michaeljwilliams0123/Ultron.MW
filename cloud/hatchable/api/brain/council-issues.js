import {collectIssuePortfolio} from 'lib/council-issues.js';

export const access='admin';
export const methods=['POST'];

function reply(res,status,value){
 res.setHeader('cache-control','private, no-store');
 return res.status(status).json({schema:'ultron.council-issues.v1',...value});
}

export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,{ok:false,error:'owner-required'});
 if(req.method!=='POST')return reply(res,405,{ok:false,error:'method-not-allowed'});
 try{
  return reply(res,200,{ok:true,portfolio:await collectIssuePortfolio()});
 }catch(error){
  return reply(res,502,{ok:false,error:String(error?.message||'inventory-failed').slice(0,80)});
 }
}
