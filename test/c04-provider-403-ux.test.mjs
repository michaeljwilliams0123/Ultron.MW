import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',import.meta.url),'utf8')
 .replace("'lib/rsa-pkcs1-sign.js'",
  JSON.stringify(new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href));
const {safeGithubPermissionSignal,classifyPrCommentFailure}=await import(
 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('GitHub 403 permission header is reduced to a fixed safe signal',()=>{
 const response=new Headers({'x-accepted-github-permissions':'issues=write;pull_requests=write'});
 assert.equal(safeGithubPermissionSignal(response),'issues-or-pull-requests-write');
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'issues=write'})),'issues-write');
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'pull_requests=write'})),'pull-requests-write');
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'issues=write;authorization=Bearer-secret'})),null);
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'x'.repeat(900)})),null);
 assert.equal(safeGithubPermissionSignal(null),null);
});

test('provider rejection classification retains only the bounded permission signal',()=>{
 const error=Object.assign(new Error('github-pr-comment-canary-provider-write-denied'),{
  providerHttpStatus:403,providerPermissionHint:'issues-or-pull-requests-write',
  privateToken:'never-report-me',headers:{authorization:'secret'}});
 assert.deepEqual(classifyPrCommentFailure(error),{
  stage:'provider_write',reason:'provider-write-denied',dispatched:null,
  providerHttpStatus:403,permissionHint:'issues-or-pull-requests-write'});
 assert.doesNotMatch(JSON.stringify(classifyPrCommentFailure(error)),/never-report-me|secret/);
 const untrusted=Object.assign(new Error('github-pr-comment-canary-provider-write-denied'),{
  providerHttpStatus:403,providerPermissionHint:'Authorization Bearer secret'});
 assert.deepEqual(classifyPrCommentFailure(untrusted),{
  stage:'provider_write',reason:'provider-write-denied',dispatched:null,
  providerHttpStatus:403});
});

test('canary UI exposes a reconciliation-only warning and explicitly explains owner signing',()=>{
 const html=readFileSync(new URL('../cloud/hatchable/public/github-pr-comment-canary.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../cloud/hatchable/public/github-pr-comment-canary.js',import.meta.url),'utf8');
 assert.match(html,/id="pending-panel"[^>]*role="alert"[^>]*hidden/);
 assert.match(html,/passkey enrollment does not sign/i);
 assert.match(html,/signing key remains on your device/i);
 assert.match(js,/pendingPanel\.hidden\s*=\s*!pendingHold/);
 assert.match(js,/submit\.hidden\s*=\s*pendingHold/);
 assert.match(js,/pendingHold\s*=\s*true/);
 assert.match(js,/pendingHold\s*=\s*false/);
});

test('a recovered unresolved attempt is readback-only, not a second GitHub POST',async()=>{
 const ids=['pull-request','prepare','diagnose','copy','comment','signable','envelope',
  'submit','reconcile','status','canary-controls','load-target','pending-panel'];
 const elements=Object.fromEntries(ids.map(id=>[id,{
  value:id==='pull-request'?'457':'',disabled:false,hidden:id==='pending-panel',
  textContent:'',style:{},addEventListener(){}
 }]));
 const calls=[];
 const fetch=async url=>{
  calls.push(String(url));
  if(url==='/api/brain/session')return {ok:true,status:200,
   json:async()=>({authenticated:true,owner:'michaeljwilliams0123'})};
  if(url==='/api/brain/github-pr-comment-canary-status?pr=457')return {
   ok:true,status:200,json:async()=>({state:'reconcile_required',pullRequest:457,
    attemptId:'ultron-task-c04-pr457-'+'a'.repeat(24),bodySha256:'b'.repeat(64)})};
  throw Error('unexpected network request '+url);
 };
 const code=readFileSync(new URL('../cloud/hatchable/public/github-pr-comment-canary.js',import.meta.url),'utf8');
 runInNewContext(code,{document:{getElementById:id=>elements[id]},fetch,window:{}});
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(elements['pending-panel'].hidden,false);
 assert.equal(elements.submit.hidden,true);
 assert.equal(elements.submit.disabled,true);
 assert.equal(elements.reconcile.disabled,false);
 assert.equal(elements['load-target'].disabled,true);
 assert.match(elements.status.textContent,/reconcile_required|readback/i);
 assert.equal(calls.length,2,'page recovery makes only authenticated session and status GETs');
});
