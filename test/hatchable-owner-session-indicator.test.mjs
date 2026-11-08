import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const file=name=>new URL('../cloud/hatchable/'+name,import.meta.url);
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

async function browser({ownerStatus=200,realtimeStatus=401,ownerBody={schema:'ultron.owner-session.v1',authenticated:true,owner:'michaeljwilliams0123'}}={}){
 const [ownerSource,liveSource]=await Promise.all([
  readFile(file('public/owner-session.js'),'utf8'),
  readFile(file('public/owner-live.js'),'utf8')
 ]);
 const nodes=new Map(['owner-session-status','owner-session-link','live-indicator'].map(id=>[
  id,{id,textContent:'',hidden:id==='owner-session-link'}]));
 const listeners={},requests=[],state={ownerStatus,realtimeStatus};
 class CustomEvent {constructor(type,{detail}={}){this.type=type;this.detail=detail}}
 const window={
  addEventListener(type,fn){(listeners[type]??=[]).push(fn)},
  dispatchEvent(event){for(const cb of listeners[event.type]||[])cb(event)},
  hatchable:{events:{connect(){return{channel(){return{on(){}}}}}}}
 };
 const document={hidden:false,getElementById(id){return nodes.get(id)}};
 const fetch=async(url)=>{
  requests.push(url);
  if(url==='/api/brain/session')return {
   ok:state.ownerStatus===200,status:state.ownerStatus,
   json:async()=>ownerBody
  };
  if(url==='/api/brain/events-token')return {
   ok:state.realtimeStatus===200,status:state.realtimeStatus,
   json:async()=>({token:'testing-placeholder'})
  };
  throw Error('Unexpected request '+url);
 };
 const sandbox={window,document,fetch,CustomEvent,console,AbortSignal};
 vm.runInNewContext(ownerSource,sandbox,{filename:'owner-session.js'});
 vm.runInNewContext(liveSource,sandbox,{filename:'owner-live.js'});
 await flush();
 return {status:nodes.get('owner-session-status'),link:nodes.get('owner-session-link'),
  live:nodes.get('live-indicator'),requests,window,
  setOwnerStatus(next){state.ownerStatus=next}};
}

test('the UI has a hidden-until-needed sign-in link and dedicated owner session endpoint',async()=>{
 const page=await readFile(file('public/index.html'),'utf8');
 assert.match(page,/id="owner-session-link"[^>]+hidden/);
 assert.match(page,/id="owner-session-status"/);
 assert.match(page,/src="\.\/owner-session\.js" defer/);
 const route=await readFile(file('api/brain/session.js'),'utf8');
 assert.match(route,/access='admin'/);
 assert.match(route,/req\.member\?\.handle/);
 assert.match(route,/Cache-Control/);
});

test('owner session stays signed in when realtime token fails 401',async()=>{
 const ui=await browser({ownerStatus:200,realtimeStatus:401});
 assert.equal(ui.link.hidden,true);
 assert.match(ui.status.textContent,/Owner authenticated/);
 assert.doesNotMatch(ui.live.textContent,/Sign in/i);
 assert.match(ui.live.textContent,/realtime|live updates/i);
 assert.equal(ui.requests.filter(x=>x==='/api/brain/session').length,1);
});

test('guest session shows sign-in, but never claims owner access',async()=>{
 const ui=await browser({ownerStatus:401,realtimeStatus:401});
 assert.equal(ui.link.hidden,false);
 assert.match(ui.status.textContent,/sign.in|required/i);
 assert.doesNotMatch(ui.status.textContent,/authenticated/i);
});

test('owner API temporarily unavailable must not falsely state signed-out',async()=>{
 const ui=await browser({ownerStatus:503,realtimeStatus:503});
 assert.equal(ui.link.hidden,true);
 assert.match(ui.status.textContent,/unavailable|unverified|retry/i);
 assert.doesNotMatch(ui.status.textContent,/sign.in required/i);
});

test('server owner-session route proves identity but never accepts client-supplied identity',async()=>{
 const m=await import(file('api/brain/session.js'));
 assert.equal(m.access,'admin');
 assert.deepEqual(m.methods,['GET']);
 function invoke(handle){
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
   status(s){this.statusCode=s;return this;},json(x){return {status:this.statusCode,headers:this.headers,body:x}}};
  return m.default({member:handle?{handle}:null},res);
 }
 const owner=invoke('michaeljwilliams0123');
 assert.equal(owner.status,200);
 assert.equal(owner.body.authenticated,true);
 assert.equal(owner.body.owner,'michaeljwilliams0123');
 assert.equal(owner.headers['Cache-Control'],'private, no-store');
 for(const identity of [null,'different-owner']){
  const other=invoke(identity);
  assert.equal(other.status,403);
  assert.equal(other.body.authenticated,false);
  assert.equal(other.body.owner,undefined);
 }
});

test('auth check uses same-origin cookies, never browser storage or events-token authority',async()=>{
 const client=await readFile(file('public/owner-session.js'),'utf8');
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/cache:'no-store'/);
 assert.match(client,/addEventListener\('focus'/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|document\.cookie|events-token/);
});

test('returning from Hatchable console refreshes the owner session without another login prompt',async()=>{
 const ui=await browser({ownerStatus:401,realtimeStatus:401});
 assert.equal(ui.link.hidden,false);
 ui.setOwnerStatus(200);
 ui.window.dispatchEvent({type:'focus'});
 await flush();
 assert.equal(ui.link.hidden,true);
 assert.match(ui.status.textContent,/Owner authenticated/);
 assert.doesNotMatch(ui.live.textContent,/Sign in/i);
 assert.equal(ui.requests.filter(x=>x==='/api/brain/session').length,2);
});
