import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDurableWebReadWorker} from '../src/durable-web-read-worker.mjs';
const origin='https://ultron-mw-cloud.hatchable.site';
const actorRef='owner:ultron';
const clock=()=> '2026-11-26T00:00:00Z';
const request={origin,actorRef,operation:'page.inspect',scope:'page.read',maxPaidCents:0,idempotencyKey:'read:browser001',path:'/browser-write-acceptance.html'};
function fixture(){
 let calls=0;
 const binding={id:'playwright-owner',provider:'playwright',runtime:'local-node',actorRef,authMethod:'local-owner',origins:[origin],operations:[{name:'page.inspect',effect:'read',scope:'page.read'}],expiresAt:'2026-11-27T00:00:00Z',maxCostCents:0,credentialRef:null};
 const adapter={health:async()=>({status:'ready',actorRef,grantedScopes:['page.read']}),
 execute:async({input})=>{calls++;assert.equal(input.url,origin+request.path);return {headingCount:1};},
 observe:async()=>({verified:true,origin}),unbind:async()=>({revoked:true})};
 return {routes:[{protocol:'playwright',binding,adapter,allowedPaths:[request.path]}],calls:()=>calls};
}
test('durable worker refuses missing database and non-read operations',()=>{
 assert.throws(()=>createDurableWebReadWorker({routes:[],clock}),/PostgreSQL/);
});
test('real PostgreSQL checkpoint prevents duplicate read dispatch across worker recreation',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql',import.meta.url),'utf8'));
  const f=fixture(), opts={db,routes:f.routes,clock,authorizeRead:async()=>true};
  const a=createDurableWebReadWorker(opts);
  const denied=await a.execute({...request,path:'//example.com/'});
  assert.equal(denied.status,'held');
  assert.equal(f.calls(),0);
  const first=await a.execute(request);
  assert.equal(first.status,'completed');
  assert.equal(first.productionAccepted,false);
  const again=await createDurableWebReadWorker(opts).execute(request);
  assert.equal(again.status,'completed');
  assert.equal(again.resumed,true);
  assert.equal(f.calls(),1);
  const rows=await db.query('SELECT status,receipt FROM capability_attempts');
  assert.equal(rows.rows.length,1);
  assert.equal(rows.rows[0].status,'completed');
  assert.equal(JSON.stringify(rows.rows[0]).includes('headingCount'),false);
 }finally{await db.close();}
});

test('owner authorization denial and unknown paths never dispatch',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql',import.meta.url),'utf8'));
  const f=fixture(), opts={db,routes:f.routes,clock};
  assert.equal((await createDurableWebReadWorker({...opts,authorizeRead:async()=>false}).execute(request)).status,'held');
  assert.equal((await createDurableWebReadWorker({...opts,authorizeRead:async()=>true}).execute({...request,path:'/unapproved.html'})).status,'held');
  assert.equal(f.calls(),0);
  assert.equal((await db.query('SELECT count(*) AS n FROM capability_attempts')).rows[0].n,0);
 }finally{await db.close();}
});

test('browser execution belongs to the local Ultron owner runtime, not CI or hosted connectors',()=>{
 const f=fixture();
 const db={query:async()=>{throw Error('No database call expected')}};
 const authorizeRead=async()=>true;
 for(const protocol of ['bidi','cdp','playwright','semantic-ui']){
  for(const identity of [{runtime:'github-actions',authMethod:'workflow-identity'},{runtime:'hosted-worker',authMethod:'oauth2'},{runtime:'cloud-api',authMethod:'app-token'},{runtime:'local-node',authMethod:'oauth2'}]){
   const route={...f.routes[0],protocol,binding:{...f.routes[0].binding,...identity}};
   assert.throws(()=>createDurableWebReadWorker({db,routes:[route],clock,authorizeRead}),/ultron-local-browser-authority-required/);
  }
 }
 assert.doesNotThrow(()=>createDurableWebReadWorker({db,routes:f.routes,clock,authorizeRead}));
});
