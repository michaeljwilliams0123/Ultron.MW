import {githubIssueWrite} from 'lib/github-issue-write.js';
export const access='admin';
export default {
 name:'ultron_github_issue_write',
 description:'Prepare, submit or reconcile a signed one-shot issue update in Ultron.MW.',
 inputSchema:{type:'object',required:['mode','request'],additionalProperties:false,properties:{
  mode:{type:'string',enum:['prepare','submit','reconcile']},
  request:{type:'object',required:['key','issueNumber','body','expectedProfileVersion','expectedStopVersion'],
   additionalProperties:false,properties:{
    key:{type:'string'},issueNumber:{type:'integer',minimum:1},body:{type:'string',maxLength:12000},
    state:{type:'string',enum:['open','closed']},expectedProfileVersion:{type:'integer',minimum:1},
    expectedStopVersion:{type:'integer',minimum:1}}},
  grantId:{type:'string'},envelope:{type:'object',required:['payload','signature'],
   additionalProperties:false,properties:{payload:{type:'string'},signature:{type:'string'}}}
 }},
 async handler(args,ctx){
  return githubIssueWrite({mode:args?.mode,request:args?.request,envelope:args?.envelope,
   grantId:args?.grantId,db:ctx?.db,config:ctx?.config});
 }
};
