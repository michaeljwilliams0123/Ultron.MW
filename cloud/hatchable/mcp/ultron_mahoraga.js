import {prepareMahoraga,submitMahoraga,reconcileMahoraga} from 'lib/mcp-mahoraga-grant.js';
export const access='admin';
export default {
 name:'ultron_mahoraga',
 description:'Prepare, submit or reconcile a signed, bounded Mahoraga issue or Verify action.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['action','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    action:{type:'object',required:['key','operation','input'],additionalProperties:false,
     properties:{key:{type:'string'},operation:{type:'string',enum:['issue.create','verify.dispatch']},
      input:{type:'object'}}},
    expectedProfileVersion:{type:'integer',minimum:1},expectedStopVersion:{type:'integer',minimum:1}
   }},
  grantId:{type:'string'},
  envelope:{type:'object',required:['payload','signature'],additionalProperties:false,
   properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  if(args?.mode==='prepare')return prepareMahoraga(args.request);
  if(args?.mode==='submit')return submitMahoraga({db:ctx?.db,config:ctx?.config,
   request:args.request,envelope:args.envelope});
  if(args?.mode==='reconcile')return reconcileMahoraga({db:ctx?.db,
   request:args.request,grantId:args.grantId});
  return {ok:false,status:'held',reason:'invalid-mode'};
 }
};
