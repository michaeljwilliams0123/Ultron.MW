import {prepareSignedNote,executeSignedNote,reconcileSignedNote} from 'lib/mcp-signed-note.js';

export const access='admin';
export default {
 name:'ultron_remember',
 description:'Prepare or submit an exact owner-adjudicated, keyed cloud note. No generic API access.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['key','kind','body','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    key:{type:'string'},kind:{type:'string',enum:['goal','observation','decision']},
    body:{type:'string',maxLength:1200},expectedProfileVersion:{type:'integer',minimum:1},
    expectedStopVersion:{type:'integer',minimum:1}
   }},
  grantId:{type:'string'},
  envelope:{type:'object',required:['payload','signature'],additionalProperties:false,
   properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  if(args?.mode==='prepare')return prepareSignedNote(args.request);
  if(args?.mode==='reconcile')return reconcileSignedNote({
   db:ctx?.db,request:args.request,grantId:args.grantId});
  if(args?.mode==='submit')return executeSignedNote({
   db:ctx?.db,config:ctx?.config,request:args.request,envelope:args.envelope});
  return {ok:false,status:'held',reason:'invalid-mode'};
 }
};
