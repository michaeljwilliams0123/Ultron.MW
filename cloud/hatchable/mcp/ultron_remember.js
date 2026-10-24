import { saveNote } from 'lib/brain-owner.js';
export const access='admin';
export default {
 name:'ultron_remember',
 description:'Persist a private, owner-approved goal, observation or decision in the Ultron cloud brain. Never submit credentials or sensitive third-party material.',
 inputSchema:{type:'object',required:['kind','body'],properties:{
  kind:{type:'string',enum:['goal','observation','decision']},
  body:{type:'string',maxLength:1200}
 }},
 async handler(args,ctx){return await saveNote({db:ctx.db},args.kind,args.body);}
};