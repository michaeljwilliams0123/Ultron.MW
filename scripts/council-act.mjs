#!/usr/bin/env node
/** Exchange this trusted owner workflow's short-lived GitHub OIDC identity for
 * the Hatchable-held, repository-scoped council App credentials. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mintInstallationToken,runMemberActions,verifyCouncilActionTarget} from '../src/council-members.mjs';

const plan=JSON.parse(readFileSync('council-members.json','utf8'));
if(!plan.ownerMode||plan.hold){
  console.log(JSON.stringify({skipped:'owner-mode-required-or-hold'}));
}else{
  const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(!requestUrl||!requestToken)throw Error('github-oidc-unavailable');
  const identityUrl=new URL(requestUrl);
  const payload=JSON.stringify(plan);
  const audience='ultron.council.v1:sha256:'+createHash('sha256').update(payload).digest('hex');
  identityUrl.searchParams.set('audience',audience);
  const identityResponse=await fetch(identityUrl,{headers:{authorization:'Bearer '+requestToken}});
  if(!identityResponse.ok)throw Error('github-oidc-request-failed:'+identityResponse.status);
  const identity=await identityResponse.json();
  if(typeof identity.value!=='string')throw Error('github-oidc-token-missing');
  const response=await fetch('https://ultron-mw-cloud.hatchable.site/api/brain/council-act',{
    method:'POST',
    headers:{authorization:'Bearer '+identity.value,'content-type':'application/json'},
    body:payload
  });
  const result=await response.json();
  if(!response.ok||!result||result.ok!==true||result.repository!=='michaeljwilliams0123/Ultron.MW')
    throw Error('hatchable-council-credential-exchange-failed:'+
      (typeof result?.error==='string'?result.error:'invalid-response'));
  const firstAssessment=plan.memberAssessments[0];
  const firstRole=firstAssessment.identity.role,firstCredentials=result.credentials?.[firstRole];
  if(!firstCredentials)throw Error('hatchable-council-credential-missing:'+firstRole);
  const firstToken=await mintInstallationToken(firstCredentials);
  await verifyCouncilActionTarget(firstToken,{number:plan.itemNumber,isPr:plan.isPr,sourceSha:plan.sourceSha});
  const report=[];
  for(const assessment of plan.memberAssessments){
    const role=assessment.identity.role,credentials=result.credentials?.[role];
    if(!credentials)throw Error('hatchable-council-credential-missing:'+role);
    try{
      const token=role===firstRole?firstToken:await mintInstallationToken(credentials);
      const actions=await runMemberActions({role,sourceSha:plan.sourceSha||process.env.GITHUB_SHA,
        token,assessment,target:{number:plan.itemNumber,isPr:plan.isPr},credentials});
      report.push({role,actions});
    }catch(error){
      report.push({role,status:'error',reason:String(error.message).slice(0,160)});
    }
  }
  console.log(JSON.stringify(report,null,2));
  if(report.some(member=>member.status==='error'||member.actions?.some(action=>action.status==='error')))process.exitCode=1;
}
