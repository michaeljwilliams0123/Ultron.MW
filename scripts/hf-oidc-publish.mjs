// Credentialless GitHub Actions -> Hatchable signed evidence delivery.
// Never log OIDC identity tokens or the runner's short-lived request bearer.
import {createHash,randomUUID} from 'node:crypto';
const number=value=>typeof value==='string'&&/^[1-9][0-9]{0,14}$/.test(value)?
 Number(value):NaN;
const runId=number(process.env.ULTRON_SOURCE_RUN_ID||'');
const runAttempt=number(process.env.ULTRON_SOURCE_RUN_ATTEMPT||'');
if(!Number.isSafeInteger(runId)||!Number.isSafeInteger(runAttempt)||
  runAttempt>20)throw Error('invalid-source-run-reference');
if(process.env.GITHUB_REPOSITORY!=='michaeljwilliams0123/Ultron.MW'||
  process.env.GITHUB_REF!=='refs/heads/main'||
  process.env.ULTRON_PAID_BUDGET_CENTS!=='0')
  throw Error('untrusted-oidc-runner-context');
const body=JSON.stringify({
 schema:'ultron.hf-oidc-run.v1',
 runId,runAttempt,deliveryId:randomUUID()
});
const digest=createHash('sha256').update(body).digest('hex');
const audience='ultron.hf-oidc.v1:sha256:'+digest;
const oidcUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if(!oidcUrl||!requestToken||!oidcUrl.startsWith('https://'))
 throw Error('github-oidc-permission-unavailable');
const endpoint=oidcUrl+(oidcUrl.includes('?')?'&':'?')+
 'audience='+encodeURIComponent(audience);
const controller=new AbortController();
const oidc=await fetch(endpoint,{
 headers:{Authorization:'Bearer '+requestToken},
 signal:AbortSignal.timeout(12000)
});
if(!oidc.ok)throw Error('oidc-mint-http-'+oidc.status);
const minted=await oidc.json();
const token=minted?.value;
if(typeof token!=='string'||token.length<250)
 throw Error('oidc-mint-invalid');
const target='https://ultron-mw-cloud.hatchable.site/api/brain/hf-oidc-event';
let result;
for(let attempt=1;attempt<=3;attempt++){
 try{
  const response=await fetch(target,{
   method:'POST',headers:{
    'Content-Type':'application/json','Authorization':'Bearer '+token
   },body,signal:AbortSignal.timeout(16000)
  });
  // Never print the Authorization header or token, including on errors.
  const json=await response.json().catch(()=>({}));
  console.log(JSON.stringify({
   sourceRunId:runId,attempt,response:response.status,
   accepted:response.ok&&json.ok===true,
   status:typeof json.status==='string'?json.status:'unavailable',
   error:typeof json.error==='string'?json.error:'none',
   scheduled:json.scheduled===true
  }));
  if(response.ok&&json.ok===true){result=json;break;}
  if(![429,503].includes(response.status))break;
 }catch{console.log('Hatchable receipt dispatch unavailable (no external action was retried)');}
 if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1800));
}
if(!result?.ok)throw Error('hatchable-signed-receipt-not-accepted');
