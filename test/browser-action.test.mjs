import test from 'node:test';
import assert from 'node:assert/strict';
import {browserActionUrl,parseBrowserAction,executeBrowserAction,unwrapBrowserIssue,BROWSER_ISSUE_MARKER}
 from '../src/browser-action.mjs';
import {parseWorkerRequest,runWorkerOperation,toLedgerResult,assertWorkerSourceSha}
 from '../src/council-worker.mjs';

const SHA='a'.repeat(40),URL='https://ultron-mw-cloud.hatchable.site/execution-canary.html';
const request=()=>({
 objectiveId:'browser-canary-execution-001',role:'Builder',op:'browser.action',sourceSha:SHA,
 params:{url:URL,steps:[
  {kind:'fill',selector:'#work-input',value:'Ultron-E2E-001'},
  {kind:'click',selector:'#run-task'}],
  expect:{selector:'#result',contains:'Applied: Ultron-E2E-001'}}
});
function adapter({unchanged=false,wrongOrigin=false,unstable=false}={}){
 let text='Not executed',closed=0,reads=0;const calls=[];
 return {calls,get closed(){return closed;},
  browser:{open:async(url,origin)=>{
   calls.push(['open',url,origin]);
   return {
    read:async selector=>{calls.push(['read',selector]);
     reads++;
     return unstable&&reads>2?'Unexpected':text;},
    perform:async step=>{calls.push(['perform',step.kind]);
      if(step.kind==='click'&&!unchanged)text='Applied: Ultron-E2E-001';},
    url:async()=>wrongOrigin?'https://github.com/':URL,
    close:async()=>{closed++}
   };
  }}
 };
}
test('browser action runs two real UI steps and double-reads the changed DOM',async()=>{
 const p=parseBrowserAction(request().params);
 const a=adapter();
 const result=await executeBrowserAction(p,a.browser);
 assert.equal(result.ok,true);
 assert.deepEqual(result.checks,{sameOrigin:true,changed:true,matched:true});
 assert.equal(a.closed,1);
 assert.deepEqual(a.calls.filter(x=>x[0]==='perform').map(x=>x[1]),['fill','click']);
 const worker=await runWorkerOperation(parseWorkerRequest(request()),adapter());
 assert.equal(worker.status,'verified');
 assert.equal(worker.verification.ok,true);
 assert.equal(toLedgerResult(worker).status,'done');
});
test('no DOM change, unstable readback or origin escape fails; context always closes',async()=>{
 const plan=parseBrowserAction(request().params);
 for(const options of [{unchanged:true},{unstable:true},{wrongOrigin:true}]){
  const a=adapter(options),out=await executeBrowserAction(plan,a.browser);
  assert.equal(out.ok,false);
  assert.equal(a.closed,1);
 }
});
test('only owned HTTPS sites and exact CSS id controls are executable',()=>{
 const original=request();
 assert.equal(browserActionUrl(URL).origin,'https://ultron-mw-cloud.hatchable.site');
 const urls=['https://github.com/','https://example.com/','http://ultron-mw-cloud.hatchable.site/',
  'https://ultron-mw-cloud.hatchable.site:8443/','https://user:pass@ultron-mw-cloud.hatchable.site/',
  'https://127.0.0.1/','file:///tmp/','https://evil.invalid/'];
 for(const url of urls)
  assert.throws(()=>parseWorkerRequest({...original,params:{...original.params,url}}),/browser-action-/);
 const changes=[
  {steps:[]},{steps:Array(7).fill({kind:'click',selector:'#run-task'})},
  {steps:[{kind:'click',selector:'body'}]},
  {steps:[{kind:'click',selector:'#run-task',value:'x'}]},
  {steps:[{kind:'fill',selector:'#work-input',value:'password=example'}]},
  {steps:[{kind:'fill',selector:'#work-input',value:'abc\nxyz'}]},
  {expect:{selector:'#result',contains:''}},
  {expect:{selector:'body',contains:'Applied'}},
  {expect:{selector:'#result',contains:'API_KEY=x'}},
 ];
 for(const patch of changes)assert.throws(
  ()=>parseWorkerRequest({...original,params:{...original.params,...patch}}),/browser-action-/);
});
test('worker request identity changes with action payload to prevent stale action replay',()=>{
 const a=parseWorkerRequest(request());
 const b=parseWorkerRequest({...request(),params:{...request().params,
  steps:[{kind:'click',selector:'#run-task'}]}});
 assert.notEqual(a.caseDigest,b.caseDigest);
 assert.equal(parseWorkerRequest(request()).caseDigest,a.caseDigest);
 const rearranged={...request(),params:{expect:{contains:'Applied: Ultron-E2E-001',selector:'#result'},
  steps:[{selector:'#work-input',value:'Ultron-E2E-001',kind:'fill'},
   {selector:'#run-task',kind:'click'}],url:URL}};
 assert.equal(parseWorkerRequest(rearranged).caseDigest,a.caseDigest);
});

test('only owner issue format can activate browser.action and preserves issue receipt',()=>{
 const source=request();
 const body=BROWSER_ISSUE_MARKER+'\n'+JSON.stringify(source);
 const parsed=unwrapBrowserIssue(body,345);
 assert.equal(parsed.issueNumber,345);
 assert.equal(parseWorkerRequest(parsed).op,'browser.action');
 for(const invalid of [body.replace('browser.action','shell.exec'),
  body.replace(BROWSER_ISSUE_MARKER,'OTHER_MARKER'),BROWSER_ISSUE_MARKER+'\nnot-json'])
  assert.throws(()=>unwrapBrowserIssue(invalid,345),/browser-issue-/);
 assert.throws(()=>unwrapBrowserIssue(body,0),/browser-issue-invalid/);
});

test('GitHub worker cannot execute an action prepared for another main SHA',()=>{
 const req=parseWorkerRequest(request());
 assert.equal(assertWorkerSourceSha(req,SHA),true);
 assert.throws(()=>assertWorkerSourceSha(req,'b'.repeat(40)),/worker-main-source-drift/);
});
