import { runMahoragaAction,mahoragaActionStatus } from 'lib/mahoraga-actions.js';
export const access='admin';
export default {
 name:'ultron_mahoraga',
 description:'Create one bounded Mahoraga issue or dispatch Verify at an exact branch SHA using a dedicated GitHub App. Each key is durable and any uncertain write is reconciled by readback without replay. status is read-only.',
 inputSchema:{type:'object',required:['action','key'],properties:{
  action:{type:'string',enum:['execute','status']},
  key:{type:'string',description:'Stable action key, 8 to 128 allowed characters'},
  operation:{type:'string',enum:['issue.create','verify.dispatch']},
  input:{type:'object',description:'Issue: title, body, expectedMainSha. Verify: ref, expectedHeadSha.'}
 }},
 async handler(args,ctx){
   if(args.action==='status')return mahoragaActionStatus({db:ctx.db},args.key);
   if(args.action!=='execute')return {ok:false,error:'unsupported-action'};
   return runMahoragaAction({db:ctx.db,config:ctx.config},args);
 }
};
