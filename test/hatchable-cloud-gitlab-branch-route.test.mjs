import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routePath=new URL('../cloud/hatchable/api/brain/gitlab-branch.js',import.meta.url);
const expectedRequest=Object.freeze({
 key:'release-v60-canary-20261108',
 sourceSha:'8c03bc3a56b41be88f65caa18568d6876bbe974c',
 expectedProfileVersion:6,expectedStopVersion:5
});
const signed=Object.freeze({payload:'signed-owner-claims',signature:'a'.repeat(86)});

async function loadRoute(fn){
 const source=await readFile(routePath,'utf8');
 const replaced=source
  .replace("import {db,config,api} from 'hatchable';",
   "const db={kind:'ledger'};const config={kind:'owner-verifier'};const api={kind:'oauth'};")
  .replace("import {gitlabBranchWrite} from 'lib/gitlab-branch-write.js';",
   'const gitlabBranchWrite=(arg)=>globalThis.__cloudGitlabSpy(arg);');
 assert.notEqual(replaced,source);
 const data='data:text/javascript;base64,'+Buffer.from(replaced).toString('base64');
 globalThis.__cloudGitlabSpy=fn;
 return import(data);
}
async function request(handler,{handle='michaeljwilliams0123',method='POST',
 body={mode:'prepare',request:expectedRequest},origin='https://ultron-mw-cloud.hatchable.site'}={}){
 const headers={origin};
 const req={method,member:handle?{handle}:null,body,headers};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
  status(code){this.statusCode=code;return this;},json(value){return {status:this.statusCode,body:value,headers:this.headers};}};
 return handler(req,res);
}

test('unauthenticated or nonowner cloud requests cannot reach provider engine',async()=>{
 let calls=0;
 const {default:handler}=await loadRoute(async()=>{calls++;return{status:'observed',ok:true};});
 for(const handle of [null,'other-repo-user']){
  const r=await request(handler,{handle,body:{mode:'submit',request:expectedRequest,envelope:signed}});
  assert.equal(r.status,403);
  assert.equal(r.body.reason,'owner-identity-required');
 }
 const csrf=await request(handler,{origin:'https://external.example',body:{mode:'submit',request:expectedRequest,envelope:signed}});
 assert.equal(csrf.status,403);
 assert.equal(calls,0);
});

test('owner cloud prepare reuses bound provider library without making a provider write',async()=>{
 const calls=[];
 const {default:handler}=await loadRoute(async arg=>{
  calls.push(arg);
  return {ok:true,grantRequest:{operation:'gitlab.branch.create',
   objectiveId:arg.request.key,profileVersion:6,stopVersion:5}};
 });
 const r=await request(handler);
 assert.equal(r.status,200);
 assert.equal(r.body.mode,'prepare');
 assert.equal(r.body.grantRequest.operation,'gitlab.branch.create');
 assert.deepEqual(calls.map(c=>c.mode),['prepare']);
 assert.equal(calls[0].api.kind,'oauth');
 assert.equal(calls[0].db.kind,'ledger');
 assert.equal(calls[0].config.kind,'owner-verifier');
 assert.equal(r.headers['Cache-Control'],'private, no-store');
});

test('owner submit sends exactly one signed request through existing provider engine',async()=>{
 const calls=[];
 const {default:handler}=await loadRoute(async arg=>{
  calls.push(arg);
  return {ok:true,status:'observed',branch:'ultron/task-release-v60-canary-20261108',
   evidence:{sourceSha:expectedRequest.sourceSha}};
 });
 const r=await request(handler,{body:{mode:'submit',request:expectedRequest,envelope:signed}});
 assert.equal(r.status,200);
 assert.equal(r.body.status,'observed');
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].envelope,signed);
 assert.equal(calls[0].grantId,undefined);
 assert.equal(JSON.stringify(r.body).includes(signed.payload),false);
});

test('cloud dispatcher rejects malformed modes and forbidden parameters before provider access',async()=>{
 let calls=0;
 const {default:handler}=await loadRoute(async()=>{calls++;return{status:'observed'};});
 const bad=[
  {mode:'submit',request:expectedRequest},
  {mode:'reconcile',request:expectedRequest},
  {mode:'prepare',request:expectedRequest,envelope:signed},
  {mode:'submit',request:expectedRequest,envelope:signed,projectId:1},
  {mode:'submit',request:{...expectedRequest,projectId:1},envelope:signed},
  {mode:'reconcile',request:expectedRequest,grantId:'bad token'},
  {mode:'delete',request:expectedRequest},
  {mode:'submit',request:expectedRequest,envelope:{...signed,privateKey:'leaked'}}
 ];
 for(const body of bad){
  const r=await request(handler,{body});
  assert.equal(r.status,400,JSON.stringify(body));
 }
 assert.equal(calls,0);
});

test('reconciliation is a readback-only mode and uncertain submit cannot trigger a second POST',async()=>{
 let calls=0;
 const {default:handler}=await loadRoute(async arg=>{
  calls++;return{ok:false,status:'reconcile-required',reason:'provider-outcome-unresolved'};
 });
 const r=await request(handler,{body:{mode:'reconcile',request:expectedRequest,grantId:'owner-grant-abc001'}});
 assert.equal(r.status,503);
 assert.equal(r.body.status,'reconcile-required');
 assert.equal(calls,1);
});

test('unexpected provider errors are reported as uncertain, not silently retried',async()=>{
 let calls=0;
 const {default:handler}=await loadRoute(async()=>{
  calls++;throw Error('provider may have committed before response');
 });
 const r=await request(handler,{body:{mode:'submit',request:expectedRequest,envelope:signed}});
 assert.equal(r.status,503);
 assert.equal(r.body.status,'reconcile-required');
 assert.equal(calls,1);
 assert.equal(JSON.stringify(r.body).includes('provider may have committed'),false);
});
