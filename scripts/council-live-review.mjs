#!/usr/bin/env node
/**
 * Trusted-main, owner-only Coordinator review executor. Exactly one limited
 * GitHub COMMENT review per PR head. PostgreSQL ledger reserve/dispatch must
 * succeed before the external write; an unknown outcome is never retried.
 * This never approves, rejects, merges, edits code, or changes secrets.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildCouncilPrContext} from '../src/council-pr-context.mjs';
import {buildCouncilReviewText} from '../src/council-review-plan.mjs';
import {councilCaseSha} from '../src/council-app-identities.mjs';
import {mintInstallationToken,runMemberActions,verifyCouncilActionTarget}
 from '../src/council-members.mjs';
import {createLedgerClient} from '../src/council-ledger-client.mjs';

const OUT='council-live-review-result.json';
const result=x=>{writeFileSync(OUT,JSON.stringify({
 schema:'ultron.council-live-review-result.v1',...x
},null,2));console.log(JSON.stringify(x));};
const plan=JSON.parse(readFileSync('council-members.json','utf8'));
const sourceSha=plan.sourceSha,prNumber=plan.itemNumber;
const owner='michaeljwilliams0123',repo='Ultron.MW';
if(!plan.isPr||!plan.ownerMode||!/^[a-f0-9]{40}$/.test(sourceSha||'')){
 result({status:'skipped',reason:'owner-pr-exact-head-required'});
}else if(process.env.COUNCIL_COORDINATOR_APP_ID!=='5633654'||
         !process.env.COUNCIL_COORDINATOR_PRIVATE_KEY){
 result({status:'skipped',reason:'coordinator-credential-not-configured'});
}else{
 try{
  const file=process.env.COUNCIL_PR_FILES_FILE;
  if(!file)throw Error('trusted-patch-context-unavailable');
  const prContext=buildCouncilPrContext(JSON.parse(readFileSync(file,'utf8')));
  if(prContext.sourceSha!==sourceSha||prContext.prNumber!==prNumber)
   throw Error('trusted-patch-target-mismatch');
  const modelReview=JSON.parse(readFileSync('council-receipt.json','utf8')).modelReview;
  const text=buildCouncilReviewText({prNumber,sourceSha,prContext,modelReview});
  if(!text){
   result({status:'skipped',reason:'no-specific-falsifiable-model-finding'});
  }else{
   const credentials={appId:'5633654',
    privateKey:process.env.COUNCIL_COORDINATOR_PRIVATE_KEY.replace(/\\n/g,'\n')};
   const token=await mintInstallationToken(credentials);
   await verifyCouncilActionTarget(token,{number:prNumber,isPr:true,sourceSha});
   const get=await fetch('https://api.github.com/repos/'+owner+'/'+repo+'/pulls/'+prNumber,{
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'ultron-council'}});
   if(!get.ok)throw Error('github-pr-readback-unavailable:'+get.status);
   const pr=await get.json();
   if(pr.state!=='open'||pr.head?.sha!==sourceSha||pr.base?.ref!=='main'||
      pr.head?.repo?.id!==1424939667||pr.user?.id!==308995719)
    throw Error('owner-pr-exact-head-drift');
   const url=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
   const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
   if(!url||!requestToken)throw Error('github-oidc-unavailable');
   const audienceToken=async body=>{
    const target=new URL(url);
    target.searchParams.set('audience','ultron.council.v1:sha256:'+
      createHash('sha256').update(body).digest('hex'));
    const response=await fetch(target,{headers:{authorization:'Bearer '+requestToken}});
    if(!response.ok)throw Error('github-oidc-mint-failed');
    const j=await response.json();
    if(typeof j.value!=='string')throw Error('github-oidc-identity-unavailable');
    return j.value;
   };
   const transport=async body=>{
    const raw=JSON.stringify(body);
    const r=await fetch('https://ultron-mw-cloud.hatchable.site/api/brain/council-ledger',{
     method:'POST',signal:AbortSignal.timeout(20000),
     headers:{authorization:'Bearer '+await audienceToken(raw),'content-type':'application/json'},
     body:raw
    });
    return{status:r.status,body:await r.json().catch(()=>null)};
   };
   // A ledger outage is a hard no-write condition.
   const probe=await transport({op:'open',limit:1});
   if(probe.status!==200||probe.body?.ok!==true)throw Error('durable-council-ledger-unavailable');
   const ledger=createLedgerClient(transport),caseSha=councilCaseSha({
    itemNumber:prNumber,isPr:true,sourceSha
   });
   const [action]=await runMemberActions({
    role:'Skeptic',sourceSha,token,credentials,
    assessment:{actions:[{op:'review.comment',why:text}]},
    target:{number:prNumber,isPr:true,caseSha,prAuthor:owner},
    ledger,profile:'engineering-autonomy'
   });
   result({status:action.status,prNumber,sourceSha,
    operation:action.op,ledgerState:action.ledgerState||null,
    executionKey:action.executionKey||null,receipt:action.receipt||null,
    reason:action.reason||null});
   if(['error','blocked','reconcile-required'].includes(action.status))process.exitCode=1;
  }
 }catch(error){
  result({status:'blocked',prNumber,sourceSha,reason:String(error.message).slice(0,180)});
  process.exitCode=1;
 }
}
