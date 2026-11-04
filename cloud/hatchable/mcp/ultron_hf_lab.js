import {getHfLabView} from 'lib/hf-lab-view.js';
export const access='admin';
export default {
 name:'ultron_hf_lab',
 description:'Read the latest bounded GitHub Actions statuses for Ultron Hugging Face CPU evaluations and the C06 model-generated PR, plus source-pinned historical repair scores and licensing holds. Read-only, zero paid provider calls and no auto-promotion.',
 inputSchema:{type:'object',properties:{}},
 async handler(_args,ctx){
  return getHfLabView({db:ctx.db});
 }
};
