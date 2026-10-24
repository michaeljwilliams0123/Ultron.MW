import { snapshot } from 'lib/brain-owner.js';
export const access='admin';
export default {
 name:'ultron_status',
 description:'Read private Ultron cloud brain objectives, current task receipts, recent events, notes and native tool capabilities. Read-only.',
 inputSchema:{type:'object',properties:{}},
 async handler(_args,ctx){return await snapshot({db:ctx.db});}
};