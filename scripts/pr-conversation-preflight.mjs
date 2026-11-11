#!/usr/bin/env node
/** Comment-router lane preflight (used at cutover, before pr-conversation).
 * Reads the PR once and writes `admit=true|false` and `status=` to
 * GITHUB_OUTPUT. An unadmitted PR is a skipped job, never a red X. Read-only. */
import {readFileSync,appendFileSync} from 'node:fs';
import {prConversationAdmission} from '../src/workflow-lane-rules.mjs';

const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const number=event.issue?.number??event.pull_request?.number;
let result={admit:false,status:'skipped-unreadable'};
try{
  const response=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/pulls/'+number,
    {headers:{authorization:'Bearer '+process.env.GITHUB_TOKEN,accept:'application/vnd.github+json'}});
  if(response.ok)result=prConversationAdmission(await response.json(),{number});
}catch{/* unreadable PR stays skipped, never admitted */}
if(process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT,'admit='+result.admit+'\nstatus='+result.status+'\n');
console.log(JSON.stringify(result));
