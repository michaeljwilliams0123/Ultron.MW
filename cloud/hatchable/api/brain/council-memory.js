import {db,config} from 'hatchable';
import {memoryMode,appendEntries,importSnapshot,exportSnapshot,storeVerifiedSnapshot,
 readCurrentScorecard} from 'lib/council-memory.js';

export const access='admin';
export const methods=['GET','POST'];

// Council memory (Phase 2). Owner-only, default OFF, fail closed: unless the
// owner sets ULTRON_COUNCIL_MEMORY_MODE=postgres, every call returns
// council-memory-disabled and touches no table. Advisory memory only.
function reply(res,status,value){
 res.setHeader('cache-control','private, no-store');
 return res.status(status).json({schema:'ultron.council-memory.api.v1',...value});
}
async function mode(){
 try{return memoryMode(await config.get('ULTRON_COUNCIL_MEMORY_MODE'))}catch{return 'off'}
}
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')return reply(res,403,{ok:false,error:'owner-required'});
 if(!['GET','POST'].includes(req.method))return reply(res,405,{ok:false,error:'method-not-allowed'});
 if(await mode()!=='postgres')return reply(res,409,{ok:false,error:'council-memory-disabled',
  setup:'Owner sets ULTRON_COUNCIL_MEMORY_MODE=postgres in Hatchable Setup after migration 0043 is applied.'});
 const site=req.headers?.['sec-fetch-site'];
 if(req.method==='POST'&&site&&site!=='same-origin')return reply(res,403,{ok:false,error:'same-origin-required'});
 try{
  if(req.method==='GET'){
   const {snapshot,lastEntryId}=await exportSnapshot(db);
   return reply(res,200,{ok:true,snapshot,lastEntryId,scorecard:await readCurrentScorecard(db),
    executes:false,countsAsApproval:false});
  }
  const op=req.body?.op;
  if(op==='append')return reply(res,200,{ok:true,...await appendEntries(db,req.body.entries)});
  if(op==='import')return reply(res,200,{ok:true,...await importSnapshot(db,req.body.snapshot)});
  if(op==='snapshot'){
   const exported=await exportSnapshot(db);
   return reply(res,200,{ok:true,...await storeVerifiedSnapshot(db,exported)});
  }
  return reply(res,400,{ok:false,error:'op-invalid'});
 }catch(error){
  const message=String(error?.message||'');
  if(/^council-memory-[a-z-]{3,60}$/.test(message))return reply(res,422,{ok:false,error:message});
  return reply(res,503,{ok:false,error:'council-memory-unavailable'});
 }
}
