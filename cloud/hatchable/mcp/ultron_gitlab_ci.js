import {observeGitLabCI} from 'lib/gitlab-ci-read.js';
import {api as sdkApi} from 'hatchable';

// Exposes GitLab observations via Ultron's own project-scoped OAuth MCP.
// GitLab API authentication is separately consented through Hatchable's
// [[api]] broker; this is not a GitLab native MCP client or token proxy.
export const access='admin';
export default {
 name:'ultron_gitlab_ci',
 description:'Read private Ultron GitLab mirror parity and latest successful verify/* pipeline metadata. Only fixed GET calls, owner access and no credential or execution authority.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 async handler(args,ctx){
  const schema='ultron.gitlab.ci-observation.v1';
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).length!==0)
   return {schema,ok:false,status:'held',reason:'invalid-arguments'};
  // MCP ctx does not have to expose the external API broker. Hatchable's
  // documented module SDK import is the primary production integration;
  // context injection remains available to the source regression suite.
  const broker=typeof ctx?.api?.call==='function'?ctx.api:sdkApi;
  if(typeof broker?.call!=='function')
   return {schema,ok:false,status:'held',reason:'gitlab-oauth-not-connected'};
  try{return await observeGitLabCI({api:broker});}
  catch{return {schema,ok:false,status:'held',reason:'gitlab-observation-unavailable'};}
 }
};
