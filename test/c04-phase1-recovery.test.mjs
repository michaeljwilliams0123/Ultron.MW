import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const root=new URL('../cloud/hatchable/',import.meta.url);
const html=await readFile(new URL('public/github-pr-comment-canary.html',root),'utf8');
const ui=await readFile(new URL('public/github-pr-comment-canary.js',root),'utf8');
const signin=await readFile(new URL('public/sign-in.js',root),'utf8');
const api=await readFile(new URL('api/brain/github-pr-comment-canary.js',root),'utf8');
const statusRoute=await readFile(new URL('api/brain/github-pr-comment-canary-status.js',root),'utf8');

function browser({session=200,state='idle',submitStatus=403}={}){
 const ids=['pull-request','load-target','prepare','diagnose','copy','comment','signable','envelope','submit','reconcile','status','canary-controls'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:id==='pull-request'?'448':'',disabled:false,textContent:'',style:{},
  listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}]));
 const calls=[],mounts=[];
 const saved={pullRequest:448,idempotencyKey:'ultron-task-c04-pr448-'+'a'.repeat(24),
  bodySha256:'b'.repeat(64),commentBody:'canonical'};
 const fetch=async(url,options={})=>{
  const input=options.body?JSON.parse(options.body):{};
  calls.push({url,mode:input.mode||'GET'});
  if(url==='/api/brain/session')return {ok:session===200,status:session,
   json:async()=>session===200?{authenticated:true,owner:'michaeljwilliams0123'}:{error:'login_required'}};
  if(url.startsWith('/api/brain/github-pr-comment-canary-status'))
   return {ok:true,status:200,json:async()=>state==='idle'?{state:'idle'}:
    {state,attemptId:saved.idempotencyKey,pullRequest:448,bodySha256:saved.bodySha256}};
  if(input.mode==='prepare')return{ok:true,status:200,json:async()=>({ok:true,prepared:saved,
   ownerGrantRequest:{operation:'pr.comment'}})};
  if(input.mode==='readback')return{ok:true,status:200,json:async()=>({ok:true,
   status:'recovered_success',receipt:{details:{commentUrl:'https://github.com/example/comment'}}})};
  if(input.mode==='submit')return{ok:submitStatus>=200&&submitStatus<300,status:submitStatus,
   json:async()=>({ok:false,error:submitStatus===403?'authority-not-verified':'provider-outcome-unresolved',
    status:submitStatus===202?'reconcile-required':undefined,dispatched:submitStatus===202?null:false})};
  if(input.mode==='diagnose')return{ok:true,status:200,json:async()=>({ok:true,
   probe:{readOnly:true,repositoryHttpStatus:200,issueHttpStatus:200,isPullRequest:true,issueState:'open',issueLocked:false,repositoryArchived:false}})};
  throw Error('unexpected '+url+' '+input.mode);
 };
 runInNewContext(ui,{document:{getElementById:id=>nodes[id]},fetch,URLSearchParams,
  location:{pathname:'/github-pr-comment-canary.html',search:'?pr=448'},
  window:{UltronSignIn:{mount:async()=>mounts.push('mounted')}},
  navigator:{clipboard:{writeText:async()=>{}}}});
 return {nodes,calls,mounts,
  async flush(){await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));},
  async click(id){await nodes[id].listeners.click();await this.flush();}};
}
function response(){return{statusCode:200,body:null,headers:{},
 setHeader(k,v){this.headers[k]=v;return this;},
 status(c){this.statusCode=c;return this;},
 json(b){this.body=b;return this;}};}
function statusHandler(db){
 const code=statusRoute.replace("import {db} from 'hatchable';",'')
  .replace("export const access='admin';",'').replace("export const methods=['GET'];",'')
  .replace('export default async function handler','async function handler');
 return runInNewContext(code+'\nhandler;',{db});
}

test('P0: mounts the real shared login recovery component and preserves PR target',async()=>{
 assert.match(html,/id="sign-in-card"[^>]*data-sign-in-card|data-sign-in-card[^>]*id="sign-in-card"/);
 assert.match(html,/src="\.\/sign-in\.js"/);
 assert.match(html,/id="canary-controls"/);
 assert.match(signin,/location\.pathname\+\(location\.search\|\|''\)/);
 const app=browser({session:401});await app.flush();
 assert.equal(app.nodes['canary-controls'].style.display,'none');
 assert.equal(app.nodes.prepare.disabled,true);
 assert.equal(app.mounts.length,1);
});

test('P0: invalid owner signature is definitive, unlocks UI, never starts readback',async()=>{
 const app=browser();await app.flush();await app.click('prepare');
 app.nodes.envelope.value=JSON.stringify({payload:'bad',signature:'bad'});
 await app.click('submit');
 assert.equal(app.nodes.prepare.disabled,false);
 assert.equal(app.nodes.submit.disabled,false);
 assert.equal(app.nodes.reconcile.disabled,true);
 assert.match(app.nodes.status.textContent,/invalid signature.*before reservation/);
 assert.equal(app.calls.filter(c=>c.mode==='readback'||c.mode==='reconcile').length,0);
});

test('P0: reload hydrates uncertain operation; one readback and zero new write posts',async()=>{
 const app=browser({state:'reconcile_required'});await app.flush();
 assert.equal(app.nodes.submit.disabled,true);
 assert.equal(app.nodes.reconcile.disabled,false);
 await app.click('reconcile');
 assert.equal(app.calls.filter(c=>c.mode==='submit').length,0);
 assert.equal(app.calls.filter(c=>c.mode==='readback').length,1);
 assert.match(app.nodes.status.textContent,/Verified recovered_success/);
});

test('P0: GET status denies non-owner and invalid PR with no database query',async()=>{
 let queries=0;const handler=statusHandler({query:async()=>{queries++;return {rows:[]};}});
 const denied=response();await handler({member:{handle:'other'},query:{pr:'448'}},denied);
 assert.equal(denied.statusCode,403);
 const invalid=response();await handler({member:{handle:'michaeljwilliams0123'},
  query:{pr:'448 OR TRUE'}},invalid);
 assert.equal(invalid.statusCode,400);
 assert.equal(queries,0);
});

test('P0: GET status reads immutable exact-repository attempt and returns safe state',async()=>{
 const query=[];
 const handler=statusHandler({query:async(sql,params)=>{query.push({sql,params});return{rows:[{
  state:'reconcile_required',idempotency_key:'ultron-task-c04-pr448-'+'a'.repeat(24),
  target_number:448,body_sha256:'b'.repeat(64),receipt:null
 }]};}});
 const res=response();await handler({member:{handle:'michaeljwilliams0123'},query:{pr:'448'}},res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.state,'reconcile_required');
 assert.deepEqual(Array.from(query[0].params),['michaeljwilliams0123/Ultron.MW',448]);
 assert.match(query[0].sql,/created_at DESC LIMIT 1/);
 assert.doesNotMatch(query[0].sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});

test('P0: DB uncertainty fails closed and does not expose provider diagnostics',async()=>{
 const handler=statusHandler({query:async()=>{throw Error('PRIVATE-SECRET');}});
 const res=response();await handler({member:{handle:'michaeljwilliams0123'},query:{pr:'448'}},res);
 assert.equal(res.statusCode,503);
 assert.equal(res.body.state,'unavailable');
 assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE-SECRET/);
});

test('P0: readback uses persisted digest and existing API, not a new mutation endpoint',()=>{
 assert.match(api,/mode==='readback'/);
 assert.match(api,/reconcilePrCommentCanary/);
 assert.match(api,/github_pr_comment_executions/);
 assert.match(api,/req\.member\?\.handle/);
 assert.doesNotMatch(api,/\/reserve'|c04_execution_attempts|router\.post/);
});
