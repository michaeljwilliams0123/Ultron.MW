#!/usr/bin/env node
/** Exchange this trusted owner workflow's short-lived GitHub OIDC identity for
 * the Hatchable-held, repository-scoped council App credentials. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

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
  if(!response.ok||result.ok!==true)throw Error('hatchable-council-action-failed:'+JSON.stringify(result));
  console.log(JSON.stringify(result,null,2));
  if(result.results?.some(item=>item.status==='error'))process.exitCode=1;
}
