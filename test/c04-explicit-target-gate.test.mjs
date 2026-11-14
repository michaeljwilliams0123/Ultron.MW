import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../cloud/hatchable/public/',import.meta.url);
const html=await readFile(new URL('github-pr-comment-canary.html',root),'utf8');
const js=await readFile(new URL('github-pr-comment-canary.js',root),'utf8');
function harness({search='',open=true,status='idle'}={}){
 const ids=['pull-request','load-target','prepare','diagnose','copy','comment','signable',
  'envelope','submit','reconcile','status','canary-controls'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,style:{},
   listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}}]));
 const calls=[];
 async function fetch(url,options={}){
  calls.push(url);
  if(url==='/api/brain/session')
   return {ok:true,status:200,json:async()=>({authenticated:true,owner:'michaeljwilliams0123'})};
  if(url.startsWith('/api/brain/github-pr-comment-canary-status'))
   return {ok:true,status:200,json:async()=>({state:status,pullRequest:447})};
  const request=JSON.parse(options.body);
  if(request.mode==='diagnose')
   return {ok:true,status:200,json:async()=>({ok:true,status:'diagnosed',
    probe:{readOnly:true,repositoryHttpStatus:200,issueHttpStatus:200,
     repositoryArchived:false,isPullRequest:true,issueState:open?'open':'closed',issueLocked:false}})};
  throw Error('Unexpected operation '+request.mode);
 }
 runInNewContext(js,{document:{getElementById:id=>nodes[id]},fetch,URLSearchParams,
  location:{pathname:'/github-pr-comment-canary.html',search},
  window:{UltronSignIn:{mount:async()=>{}}},navigator:{clipboard:{writeText:async()=>{}}}});
 return{nodes,calls,async flush(){await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));},
 async click(id){await nodes[id].listeners.click();await this.flush();}};
}
test('P2 RED: no static PR default and explicit load control',()=>{
 assert.match(html,/<input[^>]*id="pull-request"[^>]*required/);
 assert.doesNotMatch(html,/<input[^>]*id="pull-request"[^>]*value="[0-9]+"/);
 assert.match(html,/<button[^>]*id="load-target"/);
});
test('P2: session without PR query is inactive until explicit load',async()=>{
 const app=harness();await app.flush();
 assert.equal(app.nodes.prepare.disabled,true);
 assert.equal(app.calls.filter(s=>s.includes('canary-status')).length,0);
 assert.match(app.nodes.status.textContent,/Enter.*PR/i);
 app.nodes['pull-request'].value='447';
 await app.click('load-target');
 assert.equal(app.nodes.prepare.disabled,false);
 assert.ok(app.calls.some(s=>s.includes('canary-status?pr=447')));
 assert.ok(app.calls.includes('/api/brain/github-pr-comment-canary'));
});
test('P2: closed or locked canary target is rejected before preparing',async()=>{
 const app=harness({search:'?pr=447',open:false});await app.flush();
 assert.equal(app.nodes['pull-request'].value,'447');
 assert.equal(app.nodes.prepare.disabled,true);
 assert.match(app.nodes.status.textContent,/open.*unlocked/i);
});
test('P2: canonical query target is hydrated and open PR enables preparation',async()=>{
 const app=harness({search:'?pr=447'});await app.flush();
 assert.equal(app.nodes['pull-request'].value,'447');
 assert.equal(app.nodes.prepare.disabled,false);
 assert.ok(app.calls.some(s=>s.endsWith('canary-status?pr=447')));
});
