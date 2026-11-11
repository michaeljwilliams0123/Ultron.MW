import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routePath=new URL('../cloud/hatchable/api/brain/github-branch-canary.js',import.meta.url);
const OWNER='michaeljwilliams0123';
const SHA='1'.repeat(40);
const prepared={taskId:'hb-'+'a'.repeat(24),sourceSha:SHA,
 branch:'ultron/canary-hb-'+'a'.repeat(24),planSha256:'b'.repeat(64)};
const envelope={payload:'{"grantId":"owner-412-test"}',signature:'s'.repeat(86)};
const CONFIG={ULTRON_GITHUB_APP_ID:'5633654',ULTRON_GITHUB_INSTALLATION_ID:'179066535',
 ULTRON_GITHUB_APP_PRIVATE_KEY:'-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----',
 ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK:'{"kty":"EC","crv":"P-256","x":"x","y":"y"}'};

async function loadRoute({config=CONFIG,lib={}}={}){
 const source=await readFile(routePath,'utf8');
 const calls=[];
 globalThis.__branchRoute={calls,config,lib};
 const replaced=source
  .replace("import {db,config} from 'hatchable';",
   "const db={kind:'ledger'};const config={get:async name=>globalThis.__branchRoute.config[name]};")
  .replace(/import \{prepareBranchCanary[^;]+;/,
   `const spy=name=>async arg=>{globalThis.__branchRoute.calls.push({name,arg});
     return globalThis.__branchRoute.lib[name](arg);};
    const prepareBranchCanary=spy('prepare'),runBranchCanary=spy('run'),
     reconcileBranchCanary=spy('reconcile');
    const validatePreparedBranchCanary=value=>{
     if(value?.taskId!==${JSON.stringify(prepared.taskId)})throw Error('invalid');return value;};`);
 assert.notEqual(replaced,source);
 const module=await import('data:text/javascript;base64,'+Buffer.from(replaced).toString('base64')+'#'+Math.random());
 return {module,calls};
}
function call(handler,{handle=OWNER,method='POST',body,origin='https://ultron-mw-cloud.hatchable.site'}={}){
 const req={method,member:handle?{handle}:null,body,headers:origin?{origin}:{}};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
  status(code){this.statusCode=code;return this;},
  json(value){return {status:this.statusCode,body:value,headers:this.headers};}};
 return handler(req,res);
}
const submit={mode:'submit',prepared,envelope};

test('route is admin-only POST and does not modify the C04 PR-comment canary',async()=>{
 const {module}=await loadRoute();
 assert.equal(module.access,'admin');
 assert.deepEqual(module.methods,['POST']);
 const source=await readFile(routePath,'utf8');
 assert.match(source,/req\.member\?\.handle!==OWNER/);
 assert.doesNotMatch(source,/process\.env/);
 for(const name of source.matchAll(/config\.get\('([A-Z_]+)'\)/g))
  assert.ok(Object.hasOwn(CONFIG,name[1]),'reused existing config name '+name[1]);
});

test('anonymous, member and cross-origin callers never reach the pipeline',async()=>{
 const {module,calls}=await loadRoute();
 for(const handle of [null,'some-member']){
  const r=await call(module.default,{handle,body:submit});
  assert.deepEqual([r.status,r.body.error],[403,'owner-identity-required']);
 }
 const csrf=await call(module.default,{origin:'https://evil.example',body:submit});
 assert.deepEqual([csrf.status,csrf.body.error],[403,'origin-denied']);
 const get=await call(module.default,{method:'GET',body:submit});
 assert.equal(get.status,405);
 assert.equal(calls.length,0);
});

test('missing App credentials or adjudicator key return an explicit unconfigured error',async()=>{
 for(const missing of ['ULTRON_GITHUB_APP_ID','ULTRON_GITHUB_INSTALLATION_ID',
  'ULTRON_GITHUB_APP_PRIVATE_KEY','ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK']){
  const config={...CONFIG};delete config[missing];
  const {module,calls}=await loadRoute({config});
  const r=await call(module.default,{body:submit});
  assert.deepEqual([r.status,r.body.status,r.body.error],[503,'unconfigured','github-app-unconfigured']);
  assert.equal(calls.length,0);
 }
 const {module,calls}=await loadRoute({config:{...CONFIG,ULTRON_GITHUB_APP_ID:'999'}});
 const reconcile=await call(module.default,{body:{mode:'reconcile',prepared,grantId:'owner-412-test'}});
 assert.equal(reconcile.status,503);
 assert.equal(calls.length,0);
});

test('malformed requests are rejected and prepare denial is not an authorization',async()=>{
 const {module,calls}=await loadRoute({lib:{prepare:async()=>{throw Error('authority-state-denied');}}});
 for(const body of [{mode:'submit',prepared},{mode:'submit',prepared,envelope,extra:1},
  {mode:'submit',prepared:{...prepared,taskId:'hb-x'},envelope},{mode:'nope'},
  {mode:'prepare',sourceSha:'main'}]){
  const r=await call(module.default,{body});
  assert.equal(r.status,400,JSON.stringify(body));
 }
 const r=await call(module.default,{body:{mode:'prepare',sourceSha:SHA}});
 assert.deepEqual([r.status,r.body.error],[403,'canary-prepare-denied']);
 assert.deepEqual(calls.map(c=>c.name),['prepare']);
});

test('submit forwards lib status and never echoes the signed envelope',async()=>{
 const {module,calls}=await loadRoute({lib:{run:async()=>({ok:true,http:201,
  status:'success',idempotencyKey:'ultron-task-'+prepared.taskId,productionAccepted:false})}});
 const r=await call(module.default,{body:submit});
 assert.equal(r.status,201);
 assert.equal(r.body.schema,'ultron.github.branch-canary.v1');
 assert.equal(Object.hasOwn(r.body,'http'),false);
 assert.equal(JSON.stringify(r.body).includes(envelope.signature),false);
 assert.equal(r.headers['Cache-Control'],'private, no-store');
 assert.equal(calls[0].arg.appCredentials.appId,'5633654');
 const {module:held}=await loadRoute({lib:{run:async()=>({ok:false,http:202,
  status:'reconcile-required',error:'provider-outcome-unresolved'})}});
 const pending=await call(held.default,{body:submit});
 assert.deepEqual([pending.status,pending.body.status],[202,'reconcile-required']);
 const {module:broken}=await loadRoute({lib:{reconcile:async()=>{throw Error('github-branch-canary-readback-not-found');}}});
 const unresolved=await call(broken.default,{body:{mode:'reconcile',prepared,grantId:'owner-412-test'}});
 assert.deepEqual([unresolved.status,unresolved.body.status,unresolved.body.reason],
  [202,'reconcile-required','readback-not-found']);
 const {module:conflict}=await loadRoute({lib:{reconcile:async()=>{throw Error('github-branch-canary-readback-conflict');}}});
 const mismatch=await call(conflict.default,{body:{mode:'reconcile',prepared,grantId:'owner-412-test'}});
 assert.deepEqual([mismatch.body.reason,mismatch.body.providerReadbackStatus],['readback-conflict','mismatch']);
 const {module:opaque}=await loadRoute({lib:{reconcile:async()=>{throw Error('secret token text');}}});
 const hidden=await call(opaque.default,{body:{mode:'reconcile',prepared,grantId:'owner-412-test'}});
 assert.equal(Object.hasOwn(hidden.body,'reason'),false);
 assert.equal(JSON.stringify(hidden.body).includes('secret'),false);
});
