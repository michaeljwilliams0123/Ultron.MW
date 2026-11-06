import {createGraphWorkbookReader} from 'lib/graph-workbook-read.js';

export const access='admin';
export default {
 name:'ultron_graph_workbook',
 description:'Read one configured Microsoft Graph workbook cell using a delegated token.',
 inputSchema:{type:'object',required:['cell'],additionalProperties:false,
  properties:{cell:{type:'string',pattern:'^[A-Z]{1,3}[1-9][0-9]{0,6}$'}}},
 async handler(args,ctx){
  if(!args||typeof args!=='object'||Array.isArray(args)||
   Object.keys(args).length!==1||typeof args.cell!=='string')
   return {ok:false,error:'graph-request-invalid'};
  if(typeof ctx?.config?.get!=='function')
   return {ok:false,error:'graph-binding-unavailable'};
  let binding;
  try{
   const raw=await ctx.config.get('ULTRON_GRAPH_WORKBOOK_BINDING');
   if(typeof raw!=='string'||raw.length>8192)throw Error('invalid-binding');
   binding=JSON.parse(raw);
   if(!binding||typeof binding!=='object'||Array.isArray(binding)||
    Object.keys(binding).sort().join(',')!=='accountId,allowedCells,itemId,worksheetId')
    throw Error('invalid-binding');
   const reader=createGraphWorkbookReader({...binding,
    getDelegatedToken:()=>ctx.config.get('ULTRON_GRAPH_DELEGATED_TOKEN')});
   return await reader.readCell(args.cell);
  }catch{
   return {ok:false,error:'graph-binding-unavailable'};
  }
 }
};
