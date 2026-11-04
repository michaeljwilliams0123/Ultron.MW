import {collectConnectivity} from 'lib/connectivity-view.js';
export const access='admin';
export default {
 name:'ultron_connectivity',
 description:'Inspect the live Hatchable/PostgreSQL task state, exact GitHub main SHA, current-main CI and recent PRs. Read-only and bounded; missing external observations remain unavailable rather than inferred green.',
 inputSchema:{type:'object',properties:{}},
 async handler(_args,ctx){
  return collectConnectivity({db:ctx.db});
 }
};
