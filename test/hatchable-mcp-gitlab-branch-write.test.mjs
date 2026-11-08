import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,gitlabWriter,gitlabModule,providerWriter,makeTool} from './helpers/mcp-provider-fixture.mjs';

const SHA='a'.repeat(40);
const key='branchcanary001';
const branch='ultron/task-'+key;
const path='/api/v4/projects/87884831';
const input=()=>({key,sourceSha:SHA,expectedProfileVersion:2,expectedStopVersion:3});

function remote({loseAck=false,foreignSha=false,preexisting=false,maliciousCi=false,alternateCiPath=false}={}){
 let created=preexisting,posts=0;
 const calls=[];
 const branchResponse=()=>({name:branch,commit:{id:foreignSha?'b'.repeat(40):SHA},
   protected:false,default:false,
   web_url:'https://gitlab.com/michaelj.williams0123/Ultron.MW/-/tree/'+branch});
 const api={async call(name,options){
  assert.equal(name,'gitlab_write');
  calls.push({method:options.method,path:options.path,query:options.query});
  if(options.path===path&&options.method==='GET')
   return {status:200,body:{id:87884831,path_with_namespace:'michaelj.williams0123/Ultron.MW',
    default_branch:'main',visibility:'private',ci_config_path:alternateCiPath?'ci/alternate.yml':''}};
  if(options.path===path+'/repository/commits/'+SHA&&options.method==='GET')
   return {status:200,body:{id:SHA}};
  if(options.path===path+'/repository/files/.gitlab-ci.yml/raw'&&options.method==='GET'){
   assert.deepEqual(options.query,{ref:SHA});
   const yaml=await readFile(new URL('../.gitlab-ci.yml',import.meta.url),'utf8');
   return {status:200,body:maliciousCi?yaml.replace('when: never','when: always'):yaml};
  }
  if(options.path===path+'/repository/branches/'+encodeURIComponent(branch)&&options.method==='GET')
   return created?{status:200,body:branchResponse()}:{status:404,body:{message:'404 Branch Not Found'}};
  if(options.path===path+'/repository/branches'&&options.method==='POST'){
   assert.deepEqual(options.query,{branch,ref:SHA});
   posts++;
   created=true;
   if(loseAck)throw Error('lost acknowledgement');
   return {status:201,body:branchResponse()};
  }
  throw Error('unexpected API path '+options.path);
 }};
 const github=async(url,opts)=>{
  assert.equal(url,'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/commits/'+SHA);
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.Authorization,undefined);
  return new Response(JSON.stringify({sha:SHA}),{status:200});
 };
 return {api,github,calls,get posts(){return posts;}};
}

test('signed branch creation commits once and independently reads back its actual GitLab effect',async()=>{
 const h=await fixture({lostReceipt:true}),p=remote(),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 assert.equal(prepared.grantRequest.operation,'gitlab.branch.create');
 const envelope=await h.sign(prepared.grantRequest);
 const invoke=()=>gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 const first=await invoke();
 assert.equal(first.status,'observed',JSON.stringify(first));
 assert.equal(first.branch,branch);
 assert.equal(first.evidence.sourceSha,SHA);
 assert.equal(first.evidence.branchName,branch);
 assert.equal((await invoke()).status,'observed');
 assert.equal(h.claimCount,1);
 assert.equal(p.posts,1);
 assert.ok(p.calls.every(x=>['GET','POST'].includes(x.method)));
 assert.equal(p.calls.filter(x=>x.method==='POST').length,1);
});
test('lost POST acknowledgement recovers through exact branch readback without re-POST',async()=>{
 const h=await fixture(),p=remote({loseAck:true}),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const first=await gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.equal(first.status,'observed',JSON.stringify(first));
 assert.equal(first.evidence.providerAcknowledged,false);
 const later=await gitlabWriter.gitlabBranchWrite({mode:'reconcile',request,
  grantId:'test-provider-grant',db:h.db,api:p.api});
 assert.equal(later.status,'observed');
 assert.equal(p.posts,1);
});
test('unmatched existing branch, denied authority and changed key never dispatch',async()=>{
 for(const options of [{preexisting:true},{foreignSha:true,preexisting:true}]){
  const h=await fixture(),p=remote(options),request=input();
  const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
  const envelope=await h.sign(prepared.grantRequest);
  const outcome=await gitlabWriter.gitlabBranchWrite({
   mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
  assert.equal(outcome.status,'held');
  assert.equal(p.posts,0);
 }
 const h=await fixture({denied:true}),p=remote(),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const result=await gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.notEqual(result.status,'observed');
 assert.equal(p.posts,0);
 assert.equal((await gitlabWriter.gitlabBranchWrite({mode:'prepare',request:{...request,key:'BAD/branch'}})).status,'held');
});
test('MCP registered tool prepares a signed write but cannot accept caller-provided project or URL',async()=>{
 const tool=await makeTool('mcp/ultron_gitlab_branch_write.js',
  "'lib/gitlab-branch-write.js'",gitlabModule);
 const prepared=await tool.handler({mode:'prepare',request:input()},{});
 assert.equal(prepared.grantRequest.operation,'gitlab.branch.create');
 assert.equal(tool.inputSchema.additionalProperties,false);
 const denied=await tool.handler({mode:'prepare',request:{...input(),projectId:1}},{});
 assert.equal(denied.status,'held');
});
test('new signed branch operation is allowlisted but not automatically enabled',async()=>{
 const {MCP_CAPABILITIES}=await import('../cloud/hatchable/lib/mcp-capability-registry.js');
 assert.deepEqual(MCP_CAPABILITIES.find(x=>x.tool==='ultron_gitlab_branch_write'),{
  tool:'ultron_gitlab_branch_write',operation:'gitlab.branch.create',
  effect:'external-write',admission:'platform-admin-and-signed-grant-and-profile',
  keyed:true,readback:true,scope:'fixed private GitLab project 87884831 ulron task branches'.replace('ulron','ultron')
 });
});

test('changed GitLab CI workflow cannot turn a branch write into a billed runner dispatch',async()=>{
 const h=await fixture(),p=remote({maliciousCi:true}),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const result=await gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.equal(result.status,'held');
 assert.equal(result.reason,'gitlab-ci-policy-unverified');
 assert.equal(p.posts,0);
 assert.equal(h.claimCount,0);
});

test('a corrupted observed receipt with a different source SHA cannot satisfy this request',async()=>{
 const h=await fixture(),p=remote(),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const submit=()=>gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.equal((await submit()).status,'observed');
 h.row.evidence.sourceSha='b'.repeat(40);
 const denied=await submit();
 assert.equal(denied.status,'reconcile-required');
 assert.equal(denied.reason,'invalid-branch-receipt');
 assert.equal(p.posts,1,'a mismatched persisted receipt must never cause another POST');
});

test('GitLab custom project CI path is denied before branch POST or authority claim',async()=>{
 const h=await fixture(),p=remote({alternateCiPath:true}),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const result=await gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.equal(result.status,'held');
 assert.equal(result.reason,'gitlab-ci-policy-unverified');
 assert.equal(p.posts,0);
 assert.equal(h.claimCount,0);
});

test('reconciliation rejects a GitLab receipt with a source SHA different from its signed binding',async()=>{
 const h=await fixture({revoked:true}),p=remote(),request=input();
 const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
 const envelope=await h.sign(prepared.grantRequest);
 const attempt=await gitlabWriter.gitlabBranchWrite({
  mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
 assert.equal(attempt.status,'reconcile-required');
 assert.equal(h.row.status,'reconcile-required');
 assert.equal(p.posts,0);
 const binding=await providerWriter.providerBinding({
  key,operation:'gitlab.branch.create',target:[87884831,branch],payload:[SHA],
  expectedProfileVersion:2,expectedStopVersion:3
 });
 const result=await providerWriter.reconcileProviderObserved({
  db:h.db,binding,grantId:'test-provider-grant',
  evidence:{providerAcknowledged:false,readbackMatches:true,projectId:87884831,
   branchName:branch,sourceSha:'b'.repeat(40)}
 });
 assert.equal(result.status,'held',JSON.stringify(result));
 assert.equal(result.reason,'invalid-reconciliation-evidence');
 assert.equal(h.row.status,'reconcile-required','forged evidence must not persist');
});

test('signed owner versions must match exact provider binding before any claim or POST',async()=>{
 for(const tamper of ['unbound','wrong-profile','wrong-stop']){
  const h=await fixture(),p=remote(),request=input();
  const prepared=await gitlabWriter.gitlabBranchWrite({mode:'prepare',request});
  const {profileVersion,stopVersion,...withoutVersions}=prepared.grantRequest;
  let claims=tamper==='unbound'?withoutVersions:prepared.grantRequest;
  if(tamper==='wrong-profile')claims={...claims,profileVersion:request.expectedProfileVersion+1};
  if(tamper==='wrong-stop')claims={...claims,stopVersion:request.expectedStopVersion+1};
  const envelope=await h.sign(claims);
  const result=await gitlabWriter.gitlabBranchWrite({
   mode:'submit',request,envelope,db:h.db,config:h.config,api:p.api,transport:p.github});
  assert.equal(result.status,'held',JSON.stringify(result));
  assert.equal(result.reason,
   tamper==='unbound'?'grant-version-unbound':'grant-version-mismatch');
  assert.equal(p.posts,0,'a mismatched owner version must never POST');
  assert.equal(h.claimCount,0,'a mismatched owner version must never consume a grant');
 }
});
