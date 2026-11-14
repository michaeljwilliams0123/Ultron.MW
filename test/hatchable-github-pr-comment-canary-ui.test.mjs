import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const html=await readFile(new URL('../cloud/hatchable/public/github-pr-comment-canary.html',import.meta.url),'utf8');
const js=await readFile(new URL('../cloud/hatchable/public/github-pr-comment-canary.js',import.meta.url),'utf8');
test('owner UI exposes prepare, one submit and readback-only reconciliation without a key field',()=>{
 assert.match(html,/Prepare owner grant/);
 assert.match(html,/Submit one App comment/);
 assert.match(html,/Read back existing attempt/);
 assert.match(html,/Inspect GitHub App access/);
 assert.doesNotMatch(html,/(?:private[-_ ]?key|passcode|password)["']?\s*(?:id|name)=/i);
 assert.match(js,/mode:'prepare'/);
 assert.match(js,/execute\('submit'\)/);
 assert.match(js,/execute\('reconcile'\)/);
 assert.match(js,/if\(value[.]ok&&value[.]receipt\?\.[A-Za-z]+\?\.[A-Za-z]+\)/);
 assert.match(js,/envelope[.]value='';prepared=null;submitted=false/);
 assert.match(js,/credentials:'include'/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization/);
});

test('ambiguous submit permanently disables same-key POST while permitting read-only reconciliation',async()=>{
 const ids=['pull-request','prepare','diagnose','copy','comment','signable','envelope',
  'submit','reconcile','status','load-target'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',disabled:false,textContent:'',
  listeners:{},addEventListener(type,callback){this.listeners[type]=callback;}}]));
 elements['pull-request'].value='437';
 const prepared={pullRequest:437,idempotencyKey:'ultron-task-c04-pr437-'+'a'.repeat(24),
  commentBody:'exact comment',bodySha256:'b'.repeat(64)};
 const requests=[];
 const fetch=async(url,options={})=>{
  if(url==='/api/brain/session')
   return {ok:true,status:200,json:async()=>({authenticated:true,owner:'michaeljwilliams0123'})};
  if(url.startsWith('/api/brain/github-pr-comment-canary-status'))
   return {ok:true,status:200,json:async()=>({state:'idle'})};
  const input=JSON.parse(options.body);requests.push(input.mode);
  const value=input.mode==='prepare'?{ok:true,prepared,ownerGrantRequest:{actor:'owner'}}:
   input.mode==='diagnose'?{ok:true,status:'diagnosed',probe:{readOnly:true,repositoryHttpStatus:200,issueHttpStatus:200,isPullRequest:true,issueState:'open',issueLocked:false,repositoryArchived:false}}:
   {ok:false,status:'reconcile-required',error:'provider-outcome-unresolved',
    stage:'provider_write',reason:'provider-outcome-unknown',dispatched:null};
  return {ok:['prepare','diagnose'].includes(input.mode),status:['prepare','diagnose'].includes(input.mode)?200:202,
   json:async()=>value};
 };
 runInNewContext(js,{document:{getElementById:id=>elements[id]},fetch,URLSearchParams,
  location:{pathname:'/github-pr-comment-canary.html',search:'?pr=437'},
  window:{UltronSignIn:{mount:async()=>{}}},
  navigator:{clipboard:{writeText:async()=>{}}}});
 await new Promise(resolve=>setImmediate(resolve));
 await elements.prepare.listeners.click();
 elements.envelope.value=JSON.stringify({payload:'test',signature:'test'});
 await elements.submit.listeners.click();
 assert.equal(elements.submit.disabled,true,'same-key resubmission must be disabled');
 assert.equal(elements.reconcile.disabled,false,'read-only reconciliation must remain available');
 assert.equal(elements.prepare.disabled,true,'cannot replace unresolved operation with a new key');
 assert.match(elements.status.textContent,/provider-outcome-unknown/);
 assert.match(elements.status.textContent,/provider_write/);
 await elements.submit.listeners.click();
 await elements.prepare.listeners.click();
 await elements.reconcile.listeners.click();
 await elements.diagnose.listeners.click();
 assert.deepEqual(requests,['diagnose','prepare','submit','readback','diagnose']);
 assert.equal(elements.submit.disabled,true);
 assert.match(elements.status.textContent,/Read-only/);
});
