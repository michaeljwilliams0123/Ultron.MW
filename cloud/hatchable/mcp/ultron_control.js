import {prepareMutation,executeMutation,reconcileMutation} from 'lib/mcp-signed-mutation.js';
export const access='admin';
export default {
 name:'ultron_control',
 description:'Prepare, submit or reconcile a signed, keyed task state transition.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['operation','key','action','id','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    operation:{const:'mcp.task.control'},key:{type:'string',pattern:'^[a-z0-9-]{6,80}$'},
    action:{type:'string',enum:['cancel','retry','unblock']},id:{type:'integer',minimum:1,maximum:1000000000},
    expectedProfileVersion:{type:'integer',minimum:1},expectedStopVersion:{type:'integer',minimum:1}
   }},
  grantId:{type:'string'},
  envelope:{type:'object',required:['payload','signature'],additionalProperties:false,
   properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  if(args?.request?.operation!=='mcp.task.control')
   return {ok:false,status:'held',reason:'invalid-request'};
  if(args.mode==='prepare')return prepareMutation(args.request);
  if(args.mode==='reconcile')return reconcileMutation({db:ctx?.db,request:args.request,grantId:args.grantId});
  if(args.mode==='submit')return executeMutation({db:ctx?.db,config:ctx?.config,events:ctx?.events,
   request:args.request,envelope:args.envelope});
  return {ok:false,status:'held',reason:'invalid-mode'};
 }
};
