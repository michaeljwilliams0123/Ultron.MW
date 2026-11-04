#!/usr/bin/env node
/** Each council member acts under its OWN GitHub App identity using its own
 * credentials (COUNCIL_<ROLE>_APP_ID / _APP_PRIVATE_KEY / _INSTALLATION_ID).
 * Members without credentials are skipped and reported. Acts only in owner mode
 * and never while the security hold is set.
 */
import {readFileSync} from 'node:fs';
import {memberCredentials,mintInstallationToken,runMemberActions} from '../src/council-members.mjs';

const plan=JSON.parse(readFileSync('council-members.json','utf8'));
const sha=/^[a-f0-9]{40}$/.test(plan.sourceSha)?plan.sourceSha:process.env.GITHUB_SHA;
const report=[];
if(!plan.ownerMode||plan.hold){
  console.log(JSON.stringify({skipped:'owner-mode-required-or-hold'}));
}else{
  for(const a of plan.memberAssessments){
    const role=a.identity.role;
    const creds=memberCredentials(role);
    if(!creds){report.push({role,status:'no-credentials'});continue;}
    try{
      const token=await mintInstallationToken(creds);
      const results=await runMemberActions({role,sourceSha:sha,token,assessment:a,
        target:{number:plan.itemNumber}});
      report.push({role,results});
    }catch(e){report.push({role,status:'error',reason:String(e.message).slice(0,200)});}
  }
  console.log(JSON.stringify(report,null,2));
}
