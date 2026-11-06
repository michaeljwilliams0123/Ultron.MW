import {readGithubIssue} from 'lib/github-issue-read.js';
export const access='admin';
export default {
 name:'ultron_github_issue',
 description:'Read one public Ultron.MW issue by number; no arbitrary URLs or writes.',
 inputSchema:{type:'object',required:['number'],additionalProperties:false,
  properties:{number:{type:'integer',minimum:1,maximum:1000000000}}},
 async handler(args){return readGithubIssue(args?.number);}
};
