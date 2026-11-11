import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import * as door from '../cloud/hatchable/lib/council-front-door.js';

const root=new URL('../cloud/hatchable/',import.meta.url);
const b64=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
let PGlite=null;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
const skip=PGlite?false:'@electric-sql/pglite not installed';
const OWNER='michaeljwilliams0123';

test('owner-only operations become approval cards that request, never grant',()=>{
 assert.deepEqual(door.detectOwnerDecisions('Please merge PR 401 and deploy it'),['pr.merge','deploy.production']);
 assert.deepEqual(door.detectOwnerDecisions('Summarize CI health for this week'),[]);
 const cards=door.approvalCards({taskKey:'room:42',ops:['pr.merge','pr.merge','not.real']});
 assert.equal(cards.length,1);
 const [card]=cards;
 assert.equal(card.state,'requested');
 assert.equal(card.executes,false);
 assert.equal(card.countsAsApproval,false);
 assert.equal(card.approvalRequires,'owner-click-on-this-card');
 assert.deepEqual(card.choices,['approve','decline']);
 assert.equal(card.id,door.approvalCardId('room:42','pr.merge'));
 assert.notEqual(card.id,door.approvalCardId('room:43','pr.merge'),'card ids bind the task');
 assert.throws(()=>door.approvalCardId('room:x','pr.merge'),/approval-card-task-invalid/);
 assert.throws(()=>door.approvalCardId('room:1','shell.exec'),/approval-card-op-invalid/);
});

test('Companion lead reply is plain language and states that nothing runs without a click',()=>{
 const members=[{id:'builder',role:'Builder'},{id:'skeptic',role:'Skeptic'},{id:'companion',role:'Companion'}];
 const observed=[{repository:'michaeljwilliams0123/Ultron.MW',status:'observed',sha:'a'.repeat(40)}];
 const cards=door.approvalCards({taskKey:'room:7',ops:['deploy.production']});
 const lead=door.companionLead({prompt:'deploy the fix',members,observed,cards});
 assert.equal(lead.id,'companion');
 assert.equal(lead.lead,true);
 assert.match(lead.body,/Builder and Skeptic are weighing in/);
 assert.match(lead.body,/Ultron\.MW@aaaaaaa/);
 assert.match(lead.body,/Nothing happens unless you click Approve/);
 const calm=door.companionLead({prompt:'status?',members,observed:[],cards:[]});
 assert.match(calm.body,/Nothing here needs your approval/);
 assert.match(calm.body,/unverified/);
});

async function loadRoute(platform){
 globalThis.__frontDoorPlatform=platform;
 const source=await readFile(new URL('api/brain/council-room.js',root),'utf8');
 const transformed=source
  .replace("import {db,scheduler,events} from 'hatchable';",'const {db,scheduler,events}=globalThis.__frontDoorPlatform;')
  .replace("import {COUNCIL_ROOM_ROLES} from 'lib/council-room-core.js';",
   "const COUNCIL_ROOM_ROLES=[{id:'companion',role:'Companion',mandate:'Owner continuity and synthesis'}];");
 assert.notEqual(transformed,source);
 return import(b64(transformed)+'#'+Math.random());
}
const response=()=>({code:200,headers:{},status(n){this.code=n;return this},setHeader(k,v){this.headers[k]=v},
 json(body){return {status:this.code,headers:this.headers,body}}});
function roomRow(cards){
 const at='2026-11-10T12:00:00.000Z';
 return {id:5,message_key:'room:abcdefgh',author_type:'owner',author_id:OWNER,kind:'message',
  body:'merge it',mentions:[],context:{},created_at:'2026-11-10T11:59:00.000Z',
  job_id:3,task_id:9,task_key:'room:5',task_status:'done',task_updated_at:at,
  last_result:{at,summary:'done',companion:{id:'companion',role:'Companion',lead:true,body:'Got it.'},
   approvalCards:cards,members:[{id:'builder',role:'Builder',body:'plan',kind:'action'}]}};
}

test('room feed shows Companion first and attaches cards with recorded owner decisions',async()=>{
 const cards=door.approvalCards({taskKey:'room:5',ops:['pr.merge','deploy.production']});
 const queries=[];
 const route=await loadRoute({db:{async query(sql,params){queries.push(sql);
  if(/FROM council_room_approvals/.test(sql))return {rows:[{card_id:cards[0].id,decision:'approved',created_at:'2026-11-10T12:05:00Z'}]};
  return {rows:[roomRow(cards)]};}},scheduler:{},events:{}});
 const out=await route.default({method:'GET',member:{handle:OWNER},query:{}},response());
 assert.equal(out.status,200);
 assert.equal(out.body.frontDoor,'companion-first-v1');
 const ids=out.body.messages.map(m=>m.id);
 assert.deepEqual(ids,['5','lead:9','result:9:0','summary:9']);
 const lead=out.body.messages[1];
 assert.equal(lead.authorId,'companion');
 assert.equal(lead.context.lead,true);
 assert.deepEqual(lead.context.approvalCards.map(c=>c.state),['approved','requested']);
 assert.ok(lead.context.approvalCards.every(c=>c.executes===false));
 delete globalThis.__frontDoorPlatform;
});

test('room keeps working before migration 0042: cards show recording unavailable',async()=>{
 const cards=door.approvalCards({taskKey:'room:5',ops:['pr.merge']});
 const route=await loadRoute({db:{async query(sql){
  if(/FROM council_room_approvals/.test(sql))throw Error('relation "council_room_approvals" does not exist');
  return {rows:[roomRow(cards)]};}},scheduler:{},events:{}});
 const out=await route.default({method:'GET',member:{handle:OWNER},query:{}},response());
 assert.equal(out.status,200);
 assert.equal(out.body.messages[1].context.approvalCards[0].state,'decision-recording-unavailable');
 delete globalThis.__frontDoorPlatform;
});

async function freshDb(){
 const db=new PGlite();
 for(const f of ['0001_tasks.sql','0042_council_room_approvals.sql'])
  await db.exec(await readFile(new URL('migrations/'+f,root),'utf8'));
 return db;
}
async function seedTask(db,{status='done',objective='council.room',key='room:11',cards}={}){
 const r=await db.query(`INSERT INTO brain_tasks(task_key,objective,status,last_result) VALUES($1,$2,$3,$4::jsonb) RETURNING id`,
  [key,objective,status,JSON.stringify({approvalCards:cards??door.approvalCards({taskKey:key,ops:['pr.merge']})})]);
 return r.rows[0].id;
}

test('only the owner click on a stored card records a decision, once, and never executes',{skip},async()=>{
 const db=await freshDb();
 const taskId=await seedTask(db);
 const cardId=door.approvalCardId('room:11','pr.merge');
 const denied=await door.recordApprovalDecision(db,{memberHandle:'someone-else',taskId,cardId,choice:'approve'});
 assert.equal(denied.status,403);
 const invented=await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId,
  cardId:door.approvalCardId('room:11','deploy.production'),choice:'approve'});
 assert.equal(invented.status,404,'a card the Council did not request cannot be approved');
 const first=await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId,cardId,choice:'approve'});
 assert.equal(first.status,201);
 assert.equal(first.decision.decision,'approved');
 assert.equal(first.decision.executes,false);
 const replay=await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId,cardId,choice:'approve'});
 assert.equal(replay.status,200);
 const flip=await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId,cardId,choice:'decline'});
 assert.equal(flip.status,409);
 assert.equal(flip.decision.decision,'approved');
 await assert.rejects(()=>db.query(`UPDATE council_room_approvals SET decision='declined'`),/immutable/);
 await assert.rejects(()=>db.query(`DELETE FROM council_room_approvals`),/immutable/);
 await assert.rejects(()=>db.query(`INSERT INTO council_room_approvals(card_id,task_id,operation,decision,decided_by,executes)
  VALUES($1,$2,'pr.merge','approved',$3,true)`,['c'.repeat(64),taskId,OWNER]),/check/i);
 const rows=(await db.query('SELECT * FROM council_room_approvals')).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].executes,false);
});

test('tampered stored cards, unfinished tasks and other objectives are rejected',{skip},async()=>{
 const db=await freshDb();
 const forged=[{id:'d'.repeat(64),op:'pr.merge'}];
 const t1=await seedTask(db,{key:'room:12',cards:forged});
 assert.equal((await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId:t1,cardId:'d'.repeat(64),choice:'approve'})).status,404);
 const t2=await seedTask(db,{key:'room:13',status:'leased'});
 assert.equal((await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId:t2,
  cardId:door.approvalCardId('room:13','pr.merge'),choice:'approve'})).status,404);
 const t3=await seedTask(db,{key:'room:14',objective:'repo.inspect'});
 assert.equal((await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId:t3,
  cardId:door.approvalCardId('room:14','pr.merge'),choice:'approve'})).status,404);
 assert.equal((await door.recordApprovalDecision(db,{memberHandle:OWNER,taskId:t3,cardId:'x',choice:'approve'})).status,400);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM council_room_approvals')).rows[0].n,0);
});

test('approval route is owner-only POST, same-origin, and chat text cannot approve',async()=>{
 const [route,room,js]=await Promise.all([
  readFile(new URL('api/brain/council-room-approval.js',root),'utf8'),
  readFile(new URL('api/brain/council-room.js',root),'utf8'),
  readFile(new URL('public/council-room.js',root),'utf8')]);
 assert.match(route,/export const access='admin'/);
 assert.match(route,/export const methods=\['POST'\]/);
 assert.match(route,/same-origin-required/);
 assert.doesNotMatch(room,/council_room_approvals\(|INSERT INTO council_room_approvals/,
  'posting a chat message never writes a decision');
 assert.match(js,/\/api\/brain\/council-room-approval/);
 assert.match(js,/nothing runs from chat/);
});

test('front door UI: sign-in from login_url, draft hand-off never auto-sends, nav targets exist in source',async()=>{
 const [html,js,index,guard,hand,docsHand,workspace,docsIndex]=await Promise.all([
  'public/council-room.html','public/council-room.js','public/index.html','public/nav-guard.js',
  'public/council-front-door.js'].map(p=>readFile(new URL(p,root),'utf8')).concat([
  readFile(new URL('../docs/council-front-door.js',import.meta.url),'utf8'),
  readFile(new URL('public/workspace.html',root),'utf8'),
  readFile(new URL('../docs/index.html',import.meta.url),'utf8')]));
 assert.match(html,/id="sign-in-button"/);
 assert.match(js,/data\.login_url/);
 assert.match(js,/hatchable\\\.com\$/);
 assert.match(js,/#draft=/);
 assert.doesNotMatch(js.slice(js.indexOf('#draft='),js.indexOf("$('send').addEventListener")),/send\(\)/);
 assert.equal(hand,docsHand,'Pages and Hatchable hand-off scripts stay identical');
 assert.match(workspace,/council-front-door\.js/);
 assert.match(docsIndex,/council-front-door\.js/);
 assert.match(index,/href="\/council-room\.html">Council room · start here/);
 assert.match(guard,/method:'HEAD'/);
 for(const page of [html,index])for(const [,href] of page.matchAll(/<nav[\s\S]*?<\/nav>/g).next().value[0].matchAll(/href="\/([a-z0-9-]+\.html)"/g))
  assert.ok(existsSync(new URL('public/'+href,root)),'nav target missing from source: '+href);
});

test('README counts seven council profiles',async()=>{
 const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
 assert.match(readme,/Seven fixed cognitive profiles/);
 assert.doesNotMatch(readme,/Three fixed cognitive profiles/);
});

import vm from 'node:vm';
const pub=name=>readFile(new URL('public/'+name,root),'utf8');

test('shared sign-in helper allowlists hatchable.com and returns to the current page',async()=>{
 const sandbox={URL,location:{origin:'https://ultron-mw-cloud.hatchable.site',pathname:'/connectors.html'},
  window:{},document:{readyState:'complete',querySelectorAll:()=>[]},fetch:async()=>{throw Error('no fetch')}};
 vm.runInNewContext(await pub('sign-in.js'),sandbox);
 const safe=sandbox.window.UltronSignIn.safeLoginUrl;
 const login='https://hatchable.com/console/login?redirect='+encodeURIComponent(
  'https://ultron-mw-cloud.hatchable.site/__hatchable/auth/callback?next=%2F')+'&app=Ultron';
 const out=new URL(safe(login));
 assert.equal(out.hostname,'hatchable.com');
 assert.equal(new URL(out.searchParams.get('redirect')).searchParams.get('next'),'/connectors.html');
 for(const bad of ['http://hatchable.com/x','https://evil.example/login','https://hatchable.com.evil.example/','javascript:alert(1)',''])
  assert.equal(safe(bad),null,bad);
});

async function ownerSession(status,body){
 const link={hidden:true,href:'https://hatchable.com/console/projects/ultron-mw-cloud',removeAttribute(){}},indicator={textContent:''};
 const sandbox={URL,location:{origin:'https://ultron-mw-cloud.hatchable.site',pathname:'/'},
  window:{addEventListener(){},dispatchEvent(){}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},
  document:{readyState:'complete',querySelectorAll:()=>[],getElementById:id=>id==='owner-session-link'?link:id==='owner-session-status'?indicator:null},
  fetch:async()=>({ok:status===200,status,json:async()=>body})};
 vm.runInNewContext(await pub('sign-in.js'),sandbox);
 vm.runInNewContext(await pub('owner-session.js'),sandbox);
 for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
 return {link,indicator,state:sandbox.window.ultronOwnerSessionState};
}

test('Mission Control sign-in uses login_url and separates signed-out from not-owner',async()=>{
 const login='https://hatchable.com/console/login?redirect='+encodeURIComponent('https://ultron-mw-cloud.hatchable.site/__hatchable/auth/callback?next=%2F');
 const guest=await ownerSession(401,{error:'login_required',login_url:login});
 assert.equal(guest.state,'guest');
 assert.equal(guest.link.hidden,false);
 assert.match(guest.link.href,/^https:\/\/hatchable\.com\/console\/login\?/);
 const other=await ownerSession(403,{schema:'ultron.owner-session.v1',authenticated:false,reason:'owner-identity-required'});
 assert.equal(other.state,'not-owner');
 assert.match(other.indicator.textContent,/not as the owner/);
 assert.equal(other.link.hidden,false);
 const evil=await ownerSession(401,{error:'login_required',login_url:'https://evil.example/login'});
 assert.equal(evil.link.href,'https://hatchable.com/console/projects/ultron-mw-cloud','non-allowlisted login_url is ignored');
});

test('unknown paths served by the index fallback go to the Council Room',async()=>{
 const src=await pub('front-door-route.js');
 const run=pathname=>{const calls=[];vm.runInNewContext(src,{location:{pathname,replace:u=>calls.push(u)}});return calls};
 assert.deepEqual(run('/login'),['/council-room.html']);
 assert.deepEqual(run('/signin'),['/council-room.html']);
 assert.deepEqual(run('/'),[]);
 assert.deepEqual(run('/index.html'),[]);
 assert.deepEqual(run('/__hatchable/auth/callback'),[]);
 assert.match(await pub('index.html'),/<head>\n<script src="\/front-door-route\.js"><\/script>/);
});

test('every page carries the shared nav; passkeys and connectors reuse the sign-in card',async()=>{
 for(const f of ['passkey-owner.html','connectors.html','workspace.html','browser-write-acceptance.html','execution-canary.html']){
  const html=await pub(f);
  assert.match(html,/shared-nav:v1/,f);
  assert.match(html,/href="\/council-room\.html"[^>]*>Council room · start here/,f);
  assert.doesNotMatch(html.slice(html.indexOf('shared-nav:v1'),html.indexOf('</nav>',html.indexOf('shared-nav:v1'))),/<script/,f+' nav must not need script (strict CSP pages)');
 }
 for(const f of ['passkey-owner.html','connectors.html']){
  const html=await pub(f);
  assert.match(html,/data-sign-in-card/);
  assert.match(html,/src="\.\/sign-in\.js" defer/);
 }
});

test('Council Room: composer disabled when signed out, live pill bound to room state, accessible composer',async()=>{
 const [html,js,css]=await Promise.all(['council-room.html','council-room.js','council-room.css'].map(pub));
 assert.match(js,/composerEnabled\(false\);pill\('signin'\)/);
 assert.match(js,/composerEnabled\(true\)/);
 assert.match(html,/id="system-pill"[^>]*role="status"/);
 assert.doesNotMatch(html,/<span><\/span> Hatchable live<\/div>/);
 assert.match(html,/id="composer-body" aria-label="Message the council"/);
 assert.match(css,/textarea:focus-visible/);
 assert.doesNotMatch(css,/\.activity-panel\{display:none\}/);
});
