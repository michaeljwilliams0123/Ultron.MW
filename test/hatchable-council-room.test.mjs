import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../cloud/hatchable/',import.meta.url);
const roles=[
 {id:'builder',role:'Builder',mandate:'Execution path'},
 {id:'skeptic',role:'Skeptic',mandate:'Disconfirm and expose gaps'},
 {id:'steward',role:'Steward',mandate:'Authority, evidence and rollback'},
 {id:'predictor',role:'Predictor',mandate:'Likely outcomes and sequencing'},
 {id:'generator',role:'Generator',mandate:'Alternative paths'},
 {id:'sentinel',role:'Sentinel',mandate:'Drift, security and runtime watch'},
 {id:'companion',role:'Companion',mandate:'Owner continuity and synthesis'}
];
const b64=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');

async function loadRoute(platform){
 globalThis.__councilRoomPlatform=platform;
 const source=await readFile(new URL('api/brain/council-room.js',root),'utf8');
 const transformed=source
  .replace("import {db,scheduler,events} from 'hatchable';",
   'const {db,scheduler,events}=globalThis.__councilRoomPlatform;')
  .replace("import {COUNCIL_ROOM_ROLES} from 'lib/council-room-core.js';",
   'const COUNCIL_ROOM_ROLES='+JSON.stringify(roles)+';');
 assert.notEqual(transformed,source,'test platform adapters should replace route imports');
 return import(b64(transformed)+'#'+Math.random());
}

function platform({query=async()=>({rows:[]})}={}){
 const calls={queries:[],scheduled:[],published:[]};
 return {
  calls,
  db:{async query(sql,params){calls.queries.push({sql,params});return query(sql,params)}},
  scheduler:{async now(...args){calls.scheduled.push(args)}},
  events:{async publish(...args){calls.published.push(args)}}
 };
}
function response(){
 return {code:200,headers:{},status(n){this.code=n;return this;},
  setHeader(name,value){this.headers[name]=value;},
  json(body){return {status:this.code,headers:this.headers,body};}};
}
function ownerPost(overrides={}){
 return {method:'POST',member:{handle:'michaeljwilliams0123'},
  body:{messageKey:'room:test-run-001',body:'Inspect the live source and report evidence.',
   mentions:['builder','skeptic','builder','unknown'],includeMahoraga:true,...overrides}};
}

test('Council Room page is public static UI while its data route remains admin-only',async()=>{
 const [html,css,js,index,routeSource]=await Promise.all([
  readFile(new URL('public/council-room.html',root),'utf8'),
  readFile(new URL('public/council-room.css',root),'utf8'),
  readFile(new URL('public/council-room.js',root),'utf8'),
  readFile(new URL('public/index.html',root),'utf8'),
  readFile(new URL('api/brain/council-room.js',root),'utf8')
 ]);
 const p=platform(),route=await loadRoute(p);
 assert.equal(route.access,'admin');
 assert.deepEqual(route.methods,['GET','POST']);
 assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
 assert.match(html,/href="\/council-room\.css"/);
 assert.match(html,/src="\/council-room\.js"/);
 assert.match(html,/Message the council/);
 assert.match(index,/href="\/council-room\.html"/);
 assert.match(css,/\.composer/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/\/api\/brain\/council-room/);
 assert.doesNotMatch(js,/Authorization\s*:/i);
 assert.match(routeSource,/export const access='admin'/);
 assert.doesNotMatch(html+css+js,/gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----/);
 const denied=await route.default({method:'GET',member:{handle:'not-the-owner'}},response());
 assert.equal(denied.status,403);
 delete globalThis.__councilRoomPlatform;
});

test('Council Room GET exposes seven roles, integration boundaries and a zero-spend ceiling',async()=>{
 const p=platform(),route=await loadRoute(p);
 const result=await route.default({method:'GET',query:{}},response());
 assert.equal(result.status,200);
 assert.deepEqual(result.body.members.map(member=>member.id),roles.map(member=>member.id));
 assert.equal(result.body.paidSpendCeiling,0);
 assert.deepEqual(result.body.integrations,{
  hatchable:'system-of-record',github:'source-ci-and-execution-adapter',
  mahoraga:'evidence-source',cloudflare:'optional-browser-only'
 });
 assert.equal(result.headers['cache-control'],'private, no-store');
 delete globalThis.__councilRoomPlatform;
});

test('Council Room POST is idempotent and only the first durable message wakes the runner',async()=>{
 let created=true;
 const p=platform({query:async(sql,params)=>{
  assert.match(sql,/ON CONFLICT\(message_key\) DO NOTHING/);
  assert.equal(params[0],'room:test-run-001');
  const isNew=created;
  created=false;
  return {rows:[{id:17,task_id:31,task_key:'room:17',created:isNew}]};
 }});
 const route=await loadRoute(p);
 const first=await route.default(ownerPost(),response());
 const replay=await route.default(ownerPost(),response());
 assert.equal(first.status,201);
 assert.equal(first.body.created,true);
 assert.equal(replay.status,200);
 assert.equal(replay.body.created,false);
 assert.equal(p.calls.queries.length,2);
 assert.equal(p.calls.scheduled.length,1);
 assert.equal(p.calls.published.length,1);
 assert.deepEqual(JSON.parse(p.calls.queries[0].params[3]),['builder','skeptic']);
 assert.equal(p.calls.queries[0].params[4].includes('ULTRON_VAULT_KEY'),false);
 delete globalThis.__councilRoomPlatform;
});

test('Council Room rejects secret-like messages before any durable write',async()=>{
 const p=platform(),route=await loadRoute(p);
 for(const body of ['password: example-value','otp=123456',
  'github token ghp_abcdefghijklmnopqrstuvwxyz0123456789']){
  const result=await route.default(ownerPost({body}),response());
  assert.equal(result.status,422);
  assert.equal(result.body.error,'secret-like-content-rejected');
 }
 assert.equal(p.calls.queries.length,0);
 assert.equal(p.calls.scheduled.length,0);
 delete globalThis.__councilRoomPlatform;
});

test('Council Room runner returns seven role replies with private Mahoraga evidence and no credential',async()=>{
 const coreSource=await readFile(new URL('lib/council-room-core.js',root),'utf8');
 const mahoragaSource=await readFile(new URL('lib/mahoraga-actions.js',root),'utf8');
 const mahoragaUrl=b64(mahoragaSource);
 const transformed=coreSource
  .replace("import {config} from 'hatchable';",
   'const config=globalThis.__councilRoomConfig;')
  .replace("import {observeMahoragaMain} from 'lib/mahoraga-actions.js';",
   "import {observeMahoragaMain} from '"+mahoragaUrl+"';");
 assert.notEqual(transformed,coreSource);
 const originalFetch=globalThis.fetch;
 const privateToken='github_pat_this_is_a_test_credential_value';
 globalThis.__councilRoomConfig={async get(name){
  if(name==='ULTRON_MAHORAGA_CREDENTIAL_MODE')return 'pat';
  if(name==='ULTRON_MAHORAGA_CONNECTION1026')return privateToken;
  throw Error('unexpected secret name');
 }};
 const core=await import(b64(transformed)+'#'+Math.random());
 globalThis.fetch=async url=>{
  if(url.endsWith('/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main'))
   return Response.json({object:{sha:'a'.repeat(40)}});
  if(url.endsWith('/repos/michaeljwilliams0123/mahoraga'))
   return Response.json({id:1343333190,full_name:'michaeljwilliams0123/mahoraga',
    private:true,default_branch:'main'});
  if(url.endsWith('/repos/michaeljwilliams0123/mahoraga/git/ref/heads/main'))
   return Response.json({object:{sha:'b'.repeat(40)}});
  throw Error('unexpected GitHub request '+url);
 };
 try{
  const result=await core.buildCouncilRoomResult({
   message:{body:'Read the private evidence and report source commits.',mentions:[]}
  });
  assert.deepEqual(result.members.map(member=>member.id),roles.map(member=>member.id));
  const mahoraga=result.observedRepositories.find(item=>item.repository==='michaeljwilliams0123/mahoraga');
  assert.equal(mahoraga.status,'observed',mahoraga.error);
  assert.equal(mahoraga.visibility,'private');
  assert.equal(mahoraga.sha,'b'.repeat(40));
  assert.equal(result.paidCents,0);
  assert.equal(result.cloudflareRole,'optional-browser-only');
  assert.equal(JSON.stringify(result).includes(privateToken),false);
  assert.doesNotMatch(JSON.stringify(result),/github_pat_[A-Za-z0-9_]{20,}/);
 }finally{
  globalThis.fetch=originalFetch;
  delete globalThis.__councilRoomConfig;
 }
});

test('Hatchable JWK verification uses the pure-JavaScript DER conversion path',async()=>{
 const source=await readFile(new URL('lib/council-oidc.js',root),'utf8');
 assert.match(source,/function rsaJwkToPem\(jwk\)/);
 assert.match(source,/derInteger\(jwk\.n\)/);
 assert.doesNotMatch(source,/createPublicKey/);
});
