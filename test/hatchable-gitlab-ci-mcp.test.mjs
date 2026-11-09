import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sha='a'.repeat(40),otherSha='b'.repeat(40);
const projectPath='michaelj.williams0123/Ultron.MW';
const projectId=87884831;
const load=async()=>{
 const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_gitlab_ci.js',import.meta.url),'utf8');
 const helper=new URL('../cloud/hatchable/lib/gitlab-ci-read.js',import.meta.url).href;
 const sourceWithImport=source.replace("'lib/gitlab-ci-read.js'",JSON.stringify(helper))
  .replace("import {api as sdkApi} from 'hatchable';",
           "const sdkApi={call:(...args)=>globalThis.__ultronGitLabTestSdkApi?.call(...args)};");
 return (await import('data:text/javascript;base64,'+
  Buffer.from(sourceWithImport).toString('base64'))).default;
};
function connected(){
 const calls=[];
 const api={async call(name,options){
  calls.push({provider:name,method:options.method,path:options.path,keys:Object.keys(options).sort()});
  assert.equal(name,'gitlab');
  assert.equal(options.method,'GET');
  if(options.path==='/api/v4/projects/87884831')
   return {status:200,body:{id:projectId,path_with_namespace:projectPath,visibility:'private',default_branch:'main'}};
  if(options.path==='/api/v4/projects/87884831/repository/branches/main')
   return {status:200,body:{name:'main',commit:{id:sha}}};
  if(options.path==='/api/v4/projects/87884831/pipelines?per_page=20')
   return {status:200,body:[{id:100,sha:otherSha,ref:'verify/github-a5ec751',status:'success'},
    {id:99,sha,ref:'main',status:'success'}]};
  throw Error('unexpected GitLab API path');
 }};
 return {api,calls};
}
test('native GitLab MCP uses fixed read-only private project and exposes source parity without claiming live execution',async()=>{
 const tool=await load(),{api,calls}=connected();
 const old=globalThis.fetch,ghCalls=[];
 globalThis.fetch=async(url,opts)=>{
  ghCalls.push({url,method:opts.method});
  return new Response(JSON.stringify({ref:'refs/heads/main',object:{sha}}),{status:200});
 };
 try{
  assert.equal(tool.name,'ultron_gitlab_ci');
  assert.equal(tool.inputSchema.additionalProperties,false);
  const value=await tool.handler({}, {api});
  assert.equal(value.ok,true);
  assert.equal(value.readOnly,true);
  assert.equal(value.paidSpendCents,0);
  assert.equal(value.gitlab.projectId,87884831);
  assert.equal(value.gitlab.mainSha,sha);
  assert.equal(value.github.mainSha,sha);
  assert.equal(value.parity,'exact-main-match');
  assert.equal(value.latestVerification.sha,otherSha);
  assert.equal(value.latestVerification.matchesGithubMain,false);
  assert.equal(value.acceptanceVerified,false);
  assert.equal(calls.length,3);
  assert.equal(ghCalls.length,1);
  assert.ok(calls.every(x=>x.method==='GET'&&x.keys.join(',')==='method,path'));
  assert.ok(ghCalls.every(x=>x.method==='GET'&&x.url===
   'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main'));
  assert.equal((await tool.handler([], {api})).ok,true);
  const before=calls.length;
  assert.equal((await tool.handler(['unexpected'], {api})).reason,'invalid-arguments');
  assert.equal(calls.length,before);
 }finally{globalThis.fetch=old;}
});
test('invalid MCP argument, missing OAuth connection and provider mismatches fail closed before effect',async()=>{
 const tool=await load();
 let calls=0;
 const denied=await tool.handler({url:'https://evil.invalid'},{api:{call:()=>{calls++;}}});
 assert.equal(denied.status,'held');assert.equal(calls,0);
 const unconnected=await tool.handler({},{});
 assert.equal(unconnected.status,'held');
 const {api}=connected();
 const fake={call:async (...args)=>{
  const result=await api.call(...args);
  if(args[1].path==='/api/v4/projects/87884831')result.body.id=123;
  return result;
 }};
 const mismatch=await tool.handler({},{api:fake});
 assert.equal(mismatch.status,'held');
});
test('GitLab SHA divergence is surfaced explicitly, not reported as verified',async()=>{
 const tool=await load(),{api}=connected(),old=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({ref:'refs/heads/main',object:{sha:otherSha}}),{status:200});
 try{
  const value=await tool.handler({},{api});
  assert.equal(value.ok,true);
  assert.equal(value.parity,'diverged');
  assert.equal(value.acceptanceVerified,false);
 }finally{globalThis.fetch=old;}
});

test('MCP GitLab API broker works through the documented Hatchable SDK when ctx has no api',async()=>{
 const {api,calls}=connected();
 const previous=globalThis.__ultronGitLabTestSdkApi;
 const oldFetch=globalThis.fetch;
 globalThis.__ultronGitLabTestSdkApi=api;
 globalThis.fetch=async()=>new Response(JSON.stringify({ref:'refs/heads/main',object:{sha}}),{status:200});
 try {
  const tool=await load();
  const result=await tool.handler({},{});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.readOnly,true);
  assert.equal(result.parity,'exact-main-match');
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.method==='GET'));
 }finally{
  globalThis.__ultronGitLabTestSdkApi=previous;
  globalThis.fetch=oldFetch;
 }
});

test('GitLab observation is declared in the MCP capability registry as a read-only scoped tool',async()=>{
 const {MCP_CAPABILITIES}=await import('../cloud/hatchable/lib/mcp-capability-registry.js');
 const entry=MCP_CAPABILITIES.find(x=>x.tool==='ultron_gitlab_ci');
 assert.deepEqual(entry,{
  tool:'ultron_gitlab_ci',operation:'gitlab.ci.observe',effect:'read',
  admission:'platform-admin-and-configured-gitlab-oauth',readback:true,
  scope:'private GitLab Ultron.MW project 87884831 and public GitHub main ref'
 });
 assert.equal(MCP_CAPABILITIES.filter(x=>x.tool==='ultron_gitlab_ci').length,1);
});
