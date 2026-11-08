import {api as sdkApi} from 'hatchable';
import {gitlabBranchWrite} from 'lib/gitlab-branch-write.js';

// This is a signed, bounded provider WRITE. Unlike ulron_gitlab_ci it requests
// a separately consented GitLab API connection and persists one-shot receipts.
// No private key is loaded in this project; the sole owner signs externally.
export const access='admin';
export default {
 name:'ultron_gitlab_branch_write',
 description:'Prepare, submit or reconcile one owner-authorized GitLab branch creation from an exact GitHub source SHA. Requires a signed grant, versioned stop/profile policy and separate GitLab API OAuth.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['key','sourceSha','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    key:{type:'string',pattern:'^[a-z0-9-]{8,48}$'},
    sourceSha:{type:'string',pattern:'^[a-f0-9]{40}$'},
    expectedProfileVersion:{type:'integer',minimum:1},
    expectedStopVersion:{type:'integer',minimum:1}
   }},
  grantId:{type:'string'},
  envelope:{type:'object',required:['payload','signature'],additionalProperties:false,
   properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  return gitlabBranchWrite({
   mode:args?.mode,request:args?.request,envelope:args?.envelope,
   grantId:args?.grantId,db:ctx?.db,config:ctx?.config,
   api:ctx?.api??sdkApi
  });
 }
};
