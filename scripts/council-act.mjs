#!/usr/bin/env node
/** Exchange this trusted owner workflow's short-lived GitHub OIDC identity for
 * the Hatchable-held, repository-scoped council App credentials. */
import {readFileSync,writeFileSync} from 'node:fs';
import {councilCaseSha,summarizeCouncilIdentityEvidence} from '../src/council-app-identities.mjs';
import {summarizeLedger} from '../src/council-execution-ledger.mjs';
import {createLedgerClient} from '../src/council-ledger-client.mjs';
import {createHash} from 'node:crypto';
import {mintInstallationToken,runMemberActions,verifyCouncilActionTarget} from '../src/council-members.mjs';

const plan=JSON.parse(readFileSync('council-members.json','utf8'));
if(!plan.ownerMode||plan.hold){
  console.log(JSON.stringify({skipped:'owner-mode-required-or-hold'}));
}else{
  const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(!requestUrl||!requestToken)throw Error('github-oidc-unavailable');
  const oidcFor=async body=>{
    const url=new URL(requestUrl);
    url.searchParams.set('audience','ultron.council.v1:sha256:'+createHash('sha256').update(body).digest('hex'));
    const r=await fetch(url,{headers:{authorization:'Bearer '+requestToken}});
    if(!r.ok)throw Error('github-oidc-request-failed:'+r.status);
    const j=await r.json();
    if(typeof j.value!=='string')throw Error('github-oidc-token-missing');
    return j.value;
  };
  const actSha=plan.sourceSha||process.env.GITHUB_SHA;
  if(!/^[a-f0-9]{40}$/.test(actSha||'')||!Number.isSafeInteger(plan.itemNumber)||
   plan.itemNumber<1||typeof plan.isPr!=='boolean')throw Error('council-action-context-invalid');
  const caseSha=councilCaseSha({itemNumber:plan.itemNumber,isPr:plan.isPr,sourceSha:actSha});
  const ledgerUrl='https://ultron-mw-cloud.hatchable.site/api/brain/council-ledger';
  const transport=async body=>{
    const text=JSON.stringify(body);
    const r=await fetch(ledgerUrl,{method:'POST',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+await oidcFor(text),'content-type':'application/json'},body:text});
    return{status:r.status,body:await r.json().catch(()=>null)};
  };
  const probe=await transport({op:'open',limit:1}).catch(()=>null);
  if(probe?.status!==200||probe.body?.ok!==true)
    throw Error('council-ledger-required-but-unavailable');
  const ledger=createLedgerClient(transport);
  console.log(JSON.stringify({ledgerPersistence:'persisted',required:true}));
  const payload=JSON.stringify(plan);
  const identityValue=await oidcFor(payload);
  const response=await fetch('https://ultron-mw-cloud.hatchable.site/api/brain/council-act',{
    method:'POST',
    headers:{authorization:'Bearer '+identityValue,'content-type':'application/json'},
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
  await verifyCouncilActionTarget(firstToken,{number:plan.itemNumber,isPr:plan.isPr,sourceSha:actSha});
  const report=[];
  for(const assessment of plan.memberAssessments){
    const role=assessment.identity.role,credentials=result.credentials?.[role];
    if(!credentials)throw Error('hatchable-council-credential-missing:'+role);
    try{
      const token=role===firstRole?firstToken:await mintInstallationToken(credentials);
      const actions=await runMemberActions({role,sourceSha:actSha,
        token,assessment,target:{number:plan.itemNumber,isPr:plan.isPr,caseSha},credentials,ledger});
      report.push({role,actions});
    }catch(error){
      report.push({role,status:'error',reason:String(error.message).slice(0,160)});
    }
  }
  const ledgerOut=report.flatMap(m=>(m.actions||[]).filter(a=>a.executionKey).map(a=>({
    role:m.role,operation:a.op,key:a.executionKey,state:a.ledgerState||'unknown',
    status:a.status,persisted:Boolean(a.ledgerState)
  })));
  writeFileSync('council-execution-ledger.json',JSON.stringify(ledgerOut));
  console.log(JSON.stringify({executionLedger:summarizeLedger(ledgerOut),persistedRecords:ledgerOut.filter(r=>r.persisted).length}));
  const receipts=report.flatMap(m=>(m.actions||[]).map(a=>a.receipt).filter(Boolean));
  writeFileSync('council-execution-receipts.json',JSON.stringify(receipts));
  console.log(JSON.stringify({identityEvidence:summarizeCouncilIdentityEvidence(receipts,{caseSha,sourceSha:actSha})}));
  console.log(JSON.stringify(report,null,2));
  const incomplete=new Set(['error','blocked','ack-interrupted','reconcile-required']);
  if(report.some(member=>incomplete.has(member.status)||
   member.actions?.some(action=>incomplete.has(action.status))))process.exitCode=1;
}
