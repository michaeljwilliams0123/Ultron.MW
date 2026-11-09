#!/usr/bin/env node
/** Phase 2 worker entrypoint. Runs one allowlisted objective in a short-lived
 * GitHub-hosted job: reserve in the Hatchable ledger -> execute -> verify ->
 * settle -> report. Fails closed when the ledger is unreachable. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseWorkerRequest,runWorkerOperation,toLedgerResult,sha256} from '../src/council-worker.mjs';
import {unwrapBrowserIssue} from '../src/browser-action.mjs';
import {createLedgerClient,runLedgeredAction} from '../src/council-ledger-client.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const LEDGER='https://ultron-mw-cloud.hatchable.site/api/brain/council-ledger';
const raw=process.env.WORKER_REQUEST||readFileSync('council-worker-request.json','utf8');
const issueNumber=Number(process.env.WORKER_ISSUE_NUMBER||0);
const request=process.env.GITHUB_EVENT_NAME==='issues'?
  unwrapBrowserIssue(raw,issueNumber):raw;
const req=parseWorkerRequest(request);

const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
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
const ledger=createLedgerClient(async body=>{
  const text=JSON.stringify(body);
  const r=await fetch(LEDGER,{method:'POST',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+await oidcFor(text),'content-type':'application/json'},body:text});
  return{status:r.status,body:await r.json().catch(()=>null)};
});

const gh=token=>async path=>{
  const r=await fetch('https://api.github.com'+path,{signal:AbortSignal.timeout(15000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'ultron-council-worker'}});
  if(!r.ok)throw Error('github-'+r.status);
  return r.json();
};
const deps={github:gh(process.env.GITHUB_TOKEN)};
if(process.env.MAHORAGA_REPOSITORY&&process.env.MAHORAGA_READ_TOKEN){
  deps.mahoragaRepo=process.env.MAHORAGA_REPOSITORY;
  deps.mahoragaGithub=gh(process.env.MAHORAGA_READ_TOKEN);
}
if(req.op==='browser.check'||req.op==='browser.action'){
  try{
    const {chromium}=await import('playwright');
    deps.browser={
      async check(url){
        const browser=await chromium.launch();
        try{
          const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
          const page=await context.newPage();
          const resp=await page.goto(url,{timeout:30000,waitUntil:'load'});
          const shot=await page.screenshot();
          return{status:resp?.status()||0,title:await page.title(),
            text:(await page.innerText('body')).slice(0,20000),screenshotSha256:sha256(shot.toString('base64'))};
        }finally{await browser.close();}
      },
      async open(url,origin){
        // No persisted cookies, privileged site sessions or cross-origin fetches.
        const browser=await chromium.launch();
        try{
          const context=await browser.newContext({
            acceptDownloads:false,serviceWorkers:'block',permissions:[]});
          await context.route('**/*',async route=>{
            let allowed=false;
            try{const u=new URL(route.request().url());
              allowed=u.protocol==='https:'&&u.origin===origin&&
                !u.username&&!u.password&&!u.port;
            }catch{}
            if(allowed)await route.continue();else await route.abort();
          });
          const page=await context.newPage();
          page.on('popup',popup=>{popup.close().catch(()=>{});});
          const response=await page.goto(url,{timeout:30000,waitUntil:'domcontentloaded'});
          if(!response||response.status()<200||response.status()>=400)
            throw Error('browser-navigation-unverified');
          return {
            read:async selector=>page.locator(selector).innerText({timeout:10000}),
            perform:async step=>{
              const loc=page.locator(step.selector);
              if(await loc.count()!==1)throw Error('browser-action-selector-not-unique');
              if(step.kind==='click')await loc.click({timeout:12000});
              else if(step.kind==='fill')await loc.fill(step.value,{timeout:12000});
              else throw Error('browser-action-unsupported-step');
            },
            url:async()=>page.url(),
            close:async()=>browser.close()
          };
        }catch(error){await browser.close();throw error;}
      }
    };
  }catch{/* missing Playwright -> explicitly unconfigured */}
}

const intent={role:req.role,operation:req.op,caseDigest:req.caseDigest,sourceSha:req.sourceSha,ordinal:0,
  authContext:{executor:'github-actions',runId:process.env.GITHUB_RUN_ID||null,objectiveId:req.objectiveId},
  expectedEffect:'worker:'+req.op,targetUrl:'worker:'+req.objectiveId};
let captured=null;
const outcome=await runLedgeredAction({ledger,intent,
  execute:async()=>{captured=await runWorkerOperation(req,deps);return toLedgerResult(captured);}});

const report={schema:'ultron.council-worker-result.v1',objectiveId:req.objectiveId,op:req.op,
  executionKey:outcome.executionKey||null,ledgerState:outcome.ledgerState||null,status:outcome.status,
  skipped:Boolean(outcome.skipped),result:captured,independentReview:false,modelInvoked:false,
  runUrl:process.env.GITHUB_SERVER_URL?process.env.GITHUB_SERVER_URL+'/'+REPO+'/actions/runs/'+process.env.GITHUB_RUN_ID:null};
writeFileSync('council-worker-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

if(req.issueNumber&&outcome.executionKey){
  const body='**Ultron worker** `'+req.op+'` → ledger `'+(report.ledgerState||'n/a')+'` (`'+report.executionKey.slice(0,12)+'`). '+
    (captured?.verification?.ok?'Verified by post-action check.':'Not verified.')+'\n\n<!-- council-worker:'+report.executionKey+' -->';
  await fetch('https://api.github.com/repos/'+REPO+'/issues/'+req.issueNumber+'/comments',{method:'POST',
    signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+process.env.GITHUB_TOKEN,
    accept:'application/vnd.github+json','user-agent':'ultron-council-worker','content-type':'application/json'},
    body:JSON.stringify({body})}).catch(()=>{});
}
if(!['done','recovered','duplicate','planned'].includes(outcome.status))process.exitCode=1;
