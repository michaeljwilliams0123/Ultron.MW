import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../cloud/hatchable/',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
async function route(query=async()=>({rows:[]})){
 globalThis.__councilFastDb={query};
 let source=read('api/brain/council-room-progress.js');
 source=source.replace("import {db} from 'hatchable';",'const db=globalThis.__councilFastDb;');
 assert.match(source,/__councilFastDb/);
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Math.random());
}
function response(){return {code:200,headers:{},status(n){this.code=n;return this},setHeader(k,v){this.headers[k]=v},json(body){return {status:this.code,headers:this.headers,body}}};}
const request=(taskId='123',room='owner-main',handle='michaeljwilliams0123')=>({method:'GET',member:{handle},query:{taskId,room}});

test('Council progress is authenticated, read-only and scoped to the conversation',async()=>{
 const calls=[];
 const m=await route(async(sql,values)=>{
  calls.push({sql,values});
  return {rows:[{id:123,status:'done',updated_at:'2026-11-22T14:00:00Z'}]};
 });
 assert.equal(m.access,'admin');assert.deepEqual(m.methods,['GET']);
 assert.equal((await m.default(request('123','owner-main','not-owner'),response())).status,403);
 assert.equal(calls.length,0);
 const result=await m.default(request(),response());
 assert.equal(result.status,200);
 assert.deepEqual({id:result.body.taskId,state:result.body.state,finished:result.body.terminal},
  {id:123,state:'done',finished:true});
 assert.deepEqual(calls[0].values,[123,'owner-main']);
 assert.match(calls[0].sql,/JOIN council_room_jobs/);
 assert.match(calls[0].sql,/JOIN council_room_messages/);
 assert.match(calls[0].sql,/m\.room_key=\$2/);
 assert.doesNotMatch(calls[0].sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
 assert.equal(result.headers['cache-control'],'private, no-store');
 delete globalThis.__councilFastDb;
});

test('Council progress rejects unrelated and malformed task ids without disclosing history',async()=>{
 const m=await route(async()=>({rows:[]}));
 for(const [taskId,room] of [['-1','owner-main'],['1.2','owner-main'],['not-a-number','owner-main'],['123','../../other'],['9007199254740993','owner-main']]){
  const out=await m.default(request(taskId,room),response());
  assert.equal(out.status,400);
 }
 const missing=await m.default(request('123'),response());
 assert.equal(missing.status,404);
 assert.equal('message' in missing.body,false);
 delete globalThis.__councilFastDb;
});

test('Council progress emits terminal and nonterminal states without claiming a model result',async()=>{
 const m=await route(async()=>({rows:[{id:123,status:'queued',updated_at:'2026-11-22T14:00:00Z'}]}));
 const queued=await m.default(request(),response());
 assert.equal(queued.body.state,'queued');
 assert.equal(queued.body.terminal,false);
 assert.equal('members' in queued.body,false);
 assert.equal('result' in queued.body,false);
 delete globalThis.__councilFastDb;
});

test('failed and error task states terminate owner polling, without disclosing the failure payload',async()=>{
 let state='failed';
 const m=await route(async()=>({rows:[{id:123,status:state,updated_at:'2026-11-22T14:00:00Z'}]}));
 for(const value of ['failed','error','blocked','canceled']){
  state=value;
  const result=await m.default(request(),response());
  assert.equal(result.status,200);
  assert.equal(result.body.state,value);
  assert.equal(result.body.terminal,true,value+' must terminate waiting');
  assert.equal('result' in result.body,false);
  assert.equal('message' in result.body,false);
 }
 delete globalThis.__councilFastDb;
});

function createDom(states=['queued','done']){
 const listeners={};
 const events=[];
 let later=null;
 const refresh={click(){events.push('refresh')}};
 const doc={
  body:{classList:{contains:name=>name==='u-council'}},
  hidden:false,
  addEventListener(name,handler){(listeners[name]??=[]).push(handler)},
  getElementById(id){return id==='refresh'?refresh:null}
 };
 const responseStates=[];
 let attempts=0;
 const sandbox={
  document:doc,location:{origin:'https://ultron-mw-cloud.hatchable.site'},
  URL,Date,Number,Math,Map,
  setTimeout(fn,ms){later={fn:()=>{later=null;return fn()},ms};return 1},
  clearTimeout(){later=null},
  fetch:async(url,opts)=>{
   attempts++;
   responseStates.push({url:String(url),opts});
   const state=states[Math.min(attempts-1,states.length-1)];
   return {ok:true,json:async()=>({ok:true,taskId:42,state,terminal:['done','blocked','canceled','failed','error'].includes(state)})};
  }
 };
 vm.runInNewContext(read('public/council-room-progress.js'),sandbox);
 return {listeners,events,responseStates,get timer(){return later},get attempts(){return attempts}};
}
test('Council browser uses light GET fallback and refreshes only after a terminal receipt',async()=>{
 const x=createDom();
 x.listeners['ultron:council-submitted'][0]({detail:{taskId:42,room:'owner-main'}});
 assert.ok(x.timer,'short refresh fallback should be armed');
 await x.timer.fn();await new Promise(r=>setImmediate(r));
 assert.equal(x.events.includes('refresh'),false,'queued task cannot be displayed as completed');
 assert.match(x.responseStates[0].url,/\/api\/brain\/council-room-progress\?/);
 assert.equal(x.responseStates[0].opts.credentials,'same-origin');
 await x.timer.fn();await new Promise(r=>setImmediate(r));
 assert.deepEqual(x.events,['refresh']);
 assert.equal(x.timer,null,'stop when actual receipt is terminal');
});
test('browser refreshes once on a failed receipt and does not spin indefinitely',async()=>{
 const x=createDom(['failed']);
 x.listeners['ultron:council-submitted'][0]({detail:{taskId:42,room:'owner-main'}});
 assert.ok(x.timer);
 await x.timer.fn();
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(x.events,['refresh']);
 assert.equal(x.timer,null);
 assert.equal(x.attempts,1);
});
test('normal Council send and initial room snapshot emit task events',()=>{
 const room=read('public/council-room.js');
 const html=read('public/council-room.html');
 assert.match(room,/ultron:council-submitted/);
 assert.match(room,/ultron:council-jobs/);
 assert.match(html,/src="\/council-room-progress\.js"\s+defer/);
});
