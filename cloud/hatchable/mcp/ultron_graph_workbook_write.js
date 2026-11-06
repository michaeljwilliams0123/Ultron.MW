import {graphWrite} from 'lib/mcp-graph-write.js';
export const access='admin';
export default {
 name:'ultron_graph_workbook_write',
 description:'Prepare, submit or reconcile a signed one-shot write to a configured Graph cell.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['key','cell','value','expectedBefore','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    key:{type:'string'},cell:{type:'string'},value:{type:['string','number','boolean']},
    expectedBefore:{type:['string','number','boolean']},
    expectedProfileVersion:{type:'integer',minimum:1},expectedStopVersion:{type:'integer',minimum:1}}},
  grantId:{type:'string'},envelope:{type:'object',required:['payload','signature'],
   additionalProperties:false,properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  return graphWrite({mode:args?.mode,request:args?.request,envelope:args?.envelope,
   grantId:args?.grantId,db:ctx?.db,config:ctx?.config});
 }
};
