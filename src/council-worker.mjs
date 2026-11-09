/** Phase 2 external execution worker core (runs inside a short-lived GitHub-hosted job).
 * Bounded, allowlisted, read/verify-only operations. Every run has a durable
 * execution key, a hard timeout, and post-action verification. No credentials,
 * no writes to third parties, no private-network egress.
 */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {parseBrowserAction,executeBrowserAction} from './browser-action.mjs';

export const WORKER_OPS=Object.freeze(['github.repo.inspect','github.ci.status','browser.check','browser.action','mahoraga.repo.inspect']);
export const WORKER_TIMEOUT_MS=120000;
export const WORKER_ROLES=Object.freeze(['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']);
const REPO='michaeljwilliams0123/Ultron.MW';
const EGRESS_ALLOW=Object.freeze(['michaeljwilliams0123.github.io','ultron-mw-cloud.hatchable.site','github.com','example.com']);
const SHA40=/^[a-f0-9]{40}$/;

export function sha256(text){return createHash('sha256').update(String(text)).digest('hex');}

function privateHost(host){
 const h=host.toLowerCase();
 if(h==='localhost'||h.endsWith('.local')||h.endsWith('.internal'))return true;
 if(isIP(h)===4){
  const [a,b]=h.split('.').map(Number);
  return a===10||a===127||a===0||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168;
 }
 return isIP(h)!==0;
}

/** SSRF-safe: https only, no credentials/ports/IP literals, allowlisted host. */
export function checkEgressUrl(raw,allow=EGRESS_ALLOW){
 let u;
 try{u=new URL(raw);}catch{throw Error('worker-url-invalid');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||privateHost(u.hostname))throw Error('worker-url-forbidden');
 if(!allow.includes(u.hostname.toLowerCase()))throw Error('worker-host-not-allowlisted');
 return u;
}

/** Validates an objective request and derives its durable execution identity. */
export function parseWorkerRequest(input,{allow=EGRESS_ALLOW}={}){
 const r=typeof input==='string'?JSON.parse(input):input;
 if(!r||typeof r!=='object')throw Error('worker-request-invalid');
 const {objectiveId,op,role='Sentinel',sourceSha,params={},issueNumber}=r;
 if(typeof objectiveId!=='string'||!/^[A-Za-z0-9._:-]{3,80}$/.test(objectiveId))throw Error('worker-objective-invalid');
 if(!WORKER_OPS.includes(op))throw Error('worker-op-not-allowed');
 if(!WORKER_ROLES.includes(role))throw Error('worker-role-invalid');
 if(!SHA40.test(sourceSha||''))throw Error('worker-source-sha-invalid');
 if(!params||typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>4000)throw Error('worker-params-invalid');
 if(issueNumber!==undefined&&(!Number.isSafeInteger(issueNumber)||issueNumber<1))throw Error('worker-issue-invalid');
 if(op==='browser.check'){checkEgressUrl(params.url,allow);}
 const browserPlan=op==='browser.action'?parseBrowserAction(params):null;
 if(op==='github.ci.status'&&!SHA40.test(params.sha||sourceSha))throw Error('worker-sha-invalid');
 return Object.freeze({objectiveId,op,role,sourceSha,params:Object.freeze({...params}),issueNumber,
  caseDigest:sha256('council-worker/1\n'+objectiveId+(browserPlan?JSON.stringify(browserPlan):''))});
}

export function assertWorkerSourceSha(request,actualSha){
 if(!request||!SHA40.test(actualSha||'')||request.sourceSha!==actualSha)
  throw Error('worker-main-source-drift');
 return true;
}

function withTimeout(promise,ms,label){
 let t;
 return Promise.race([promise,new Promise((_,rej)=>{t=setTimeout(()=>rej(Error(label+'-timeout')),ms);})])
  .finally(()=>clearTimeout(t));
}

/** deps: {github(path)->json, browser:{check(url)->{status,title,text,screenshotSha256}}, mahoragaRepo} */
export async function runWorkerOperation(req,deps,{timeoutMs=WORKER_TIMEOUT_MS}={}){
 const started=Date.now();
 const finish=(status,observed,verification,reason)=>({
  op:req.op,objectiveId:req.objectiveId,status,observed,verification,
  ...(reason?{reason}:{}),durationMs:Date.now()-started,
  modelInvoked:false,independentReview:false
 });
 try{
  switch(req.op){
   case 'github.repo.inspect':return await withTimeout((async()=>{
    const ref=await deps.github('/repos/'+REPO+'/git/ref/heads/main');
    const repo=await deps.github('/repos/'+REPO);
    const again=await deps.github('/repos/'+REPO+'/git/ref/heads/main');
    const observed={mainSha:ref.object?.sha,defaultBranch:repo.default_branch,private:repo.private};
    // Verification: two independent reads agree and return a 40-hex commit.
    const ok=SHA40.test(observed.mainSha||'')&&again.object?.sha===observed.mainSha;
    return finish(ok?'verified':'failed',observed,{method:'double-read',ok});
   })(),timeoutMs,'github');
   case 'github.ci.status':return await withTimeout((async()=>{
    const sha=req.params.sha||req.sourceSha;
    const runs=await deps.github('/repos/'+REPO+'/actions/runs?head_sha='+sha+'&per_page=50');
    const list=(runs.workflow_runs||[]).filter(x=>x.head_sha===sha);
    const observed={sha,runs:list.map(x=>({name:x.name,status:x.status,conclusion:x.conclusion,url:x.html_url}))};
    const done=list.length>0&&list.every(x=>x.status==='completed');
    const green=done&&list.every(x=>x.conclusion==='success'||x.conclusion==='skipped');
    return finish(done?'verified':'failed',{...observed,allGreen:green},
     {method:'exact-head-runs',ok:done,exactHead:true},done?undefined:'no-completed-runs-for-exact-head');
   })(),timeoutMs,'github');
   case 'browser.check':return await withTimeout((async()=>{
    if(!deps.browser)return finish('unconfigured',null,{ok:false},'browser-unavailable');
    const url=checkEgressUrl(req.params.url).toString();
    const page=await deps.browser.check(url);
    const expect=typeof req.params.expectText==='string'?req.params.expectText:null;
    const textOk=expect===null||String(page.text||'').includes(expect);
    const ok=page.status>=200&&page.status<400&&textOk;
    return finish(ok?'verified':'failed',{url,status:page.status,title:page.title,
     screenshotSha256:page.screenshotSha256},{method:'http-status+expected-text',ok,expectText:expect});
   })(),timeoutMs,'browser');
   case 'browser.action':return await withTimeout((async()=>{
    if(!deps.browser?.open)return finish('unconfigured',null,{ok:false},'browser-action-adapter-unavailable');
    const plan=parseBrowserAction(req.params);
    const observed=await executeBrowserAction(plan,deps.browser);
    return finish(observed.ok?'verified':'failed',observed,
      {method:'isolated-browser-postcondition-double-read',ok:observed.ok},
      observed.ok?undefined:'browser-postcondition-unverified');
   })(),timeoutMs,'browser');
   case 'mahoraga.repo.inspect':return await withTimeout((async()=>{
    if(!deps.mahoragaRepo||!deps.mahoragaGithub)
     return finish('unconfigured',null,{ok:false},'mahoraga-repository-or-token-not-configured');
    const repo=await deps.mahoragaGithub('/repos/'+deps.mahoragaRepo);
    return finish('verified',{repository:repo.full_name,defaultBranch:repo.default_branch,
     pushedAt:repo.pushed_at},{method:'authorized-read',ok:true});
   })(),timeoutMs,'mahoraga');
   default:return finish('failed',null,{ok:false},'unsupported');
  }
 }catch(e){
  return finish('failed',null,{ok:false},String(e.message).slice(0,160));
 }
}

/** Map a worker result onto the ledger's action-result contract. Only a
 * verified result is `done`; the worker is never an independent identity. */
export function toLedgerResult(result){
 if(result.status==='verified')return{op:result.op,status:'done',
  effect:{executor:'github-actions[bot]',url:'worker:'+result.objectiveId},result};
 return{op:result.op,status:result.status==='unconfigured'?'unconfigured':'failed',
  reason:result.reason||result.status,result};
}
