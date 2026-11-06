import {prepareMutation,executeMutation,reconcileMutation} from 'lib/mcp-signed-mutation.js';
export const access='admin';
export default {
 name:'ultron_queue',
 description:'Prepare, submit or reconcile a signed, keyed read-only objective.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['operation','key','objective','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    operation:{const:'mcp.queue.submit'},key:{type:'string',pattern:'^[a-z0-9-]{6,80}$'},
    objective:{type:'string',enum:['repo.inspect','repo.prs','repo.ci','site.render','council.review']},
    expectedProfileVersion:{type:'integer',minimum:1},expectedStopVersion:{type:'integer',minimum:1}
   }},
  grantId:{type:'string'},
  envelope:{type:'object',required:['payload','signature'],additionalProperties:false,
   properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  if(args?.request?.operation!=='mcp.queue.submit')
   return {ok:false,status:'held',reason:'invalid-request'};
  if(args.mode==='prepare')return prepareMutation(args.request);
  if(args.mode==='reconcile')return reconcileMutation({db:ctx?.db,request:args.request,grantId:args.grantId});
  if(args.mode==='submit')return executeMutation({db:ctx?.db,config:ctx?.config,events:ctx?.events,
   request:args.request,envelope:args.envelope});
  return {ok:false,status:'held',reason:'invalid-mode'};
 }
};
