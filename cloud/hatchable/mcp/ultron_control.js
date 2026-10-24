import { controlTask } from 'lib/brain-owner.js';
export const access='admin';
export default {
 name:'ultron_control',
 description:'Owner-controlled state transitions: cancel a queued or blocked Ultron objective, or retry a blocked objective. Does not terminate running work or touch GitHub.',
 inputSchema:{type:'object',required:['action','id'],properties:{
  action:{type:'string',enum:['cancel','retry']},
  id:{type:'integer',minimum:1}
 }},
 async handler(args,ctx){return await controlTask({db:ctx.db},args.action,args.id);}
};