import { queueObjective,readQueuedObjective } from 'lib/brain-owner.js';
const OBJECTIVES=['repo.inspect','repo.prs','repo.ci','site.render','council.review'];
export const access='admin';
export default {
 name:'ultron_queue',
 description:'Queue an explicit read-only objective, or reconcile it by key without writing. Does not modify GitHub.',
 inputSchema:{type:'object',required:['objective','key'],properties:{
  objective:{type:'string',enum:OBJECTIVES},
  key:{type:'string',description:'Caller-generated lowercase idempotency key (6-80 characters)'},
  mode:{type:'string',enum:['submit','reconcile'],description:'Use reconcile for read-only outcome recovery'}
 }},
 async handler(args,ctx){
  if(!OBJECTIVES.includes(args?.objective))return {ok:false,error:'unsupported-objective'};
  if(typeof args?.key!=='string')return {ok:false,error:'invalid-idempotency-key'};
  if(args.mode!==undefined&&!['submit','reconcile'].includes(args.mode))
   return {ok:false,error:'invalid-queue-mode'};
  if(args.mode==='reconcile')return await readQueuedObjective({db:ctx.db},args.objective,args.key);
  return await queueObjective({db:ctx.db,scheduler:ctx.scheduler,events:ctx.events},args.objective,args.key);
 }
};