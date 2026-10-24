import { queueObjective } from 'lib/brain-owner.js';
export const access='admin';
export default {
 name:'ultron_queue',
 description:'Queue one explicit native read-only Ultron cloud objective and request immediate execution. Idempotent with optional key. Does not modify GitHub.',
 inputSchema:{type:'object',required:['objective'],properties:{
  objective:{type:'string',enum:['repo.inspect','repo.prs','repo.ci','site.render','council.review']},
  key:{type:'string',description:'Optional lowercase idempotency key (6-80 characters)'}
 }},
 async handler(args,ctx){return await queueObjective({db:ctx.db,scheduler:ctx.scheduler},args.objective,args.key);}
};