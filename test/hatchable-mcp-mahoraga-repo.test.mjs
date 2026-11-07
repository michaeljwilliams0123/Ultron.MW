import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const repo='michaeljwilliams0123/mahoraga';
const mainSha='a'.repeat(40);

test('native OAuth MCP tool reads authenticated Mahoraga repository with real adapter and no repo writes',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_mahoraga_repo.js',
  import.meta.url),'utf8');
 assert.match(source,/export const access='admin'/);
 assert.match(source,/name:'ultron_mahoraga_repo'/);
 const helper=new URL('../cloud/hatchable/lib/mahoraga-actions.js',import.meta.url).href;
 const moduleSource=source.replace("'lib/mahoraga-actions.js'",JSON.stringify(helper));
 const {default:tool}=await import('data:text/javascript;base64,'+
  Buffer.from(moduleSource).toString('base64'));
 assert.equal(tool.name,'ultron_mahoraga_repo');
 assert.deepEqual(tool.inputSchema.required??[],[]);
 assert.equal(tool.inputSchema.additionalProperties,false);
 const original=globalThis.fetch,calls=[],config={
  get:async(name)=>name==='ULTRON_MAHORAGA_CREDENTIAL_MODE'?null:
   name==='ULTRON_MAHORAGA_CONNECTION1026'?'github_pat_'+'a'.repeat(40):null
 };
 globalThis.fetch=async(url,options)=>{
  calls.push({url,method:options.method,authProvided:options.headers?.Authorization?.startsWith('Bearer ')});
  let payload;
  if(url==='https://api.github.com/repos/'+repo)
   payload={id:1343333190,full_name:repo,private:true,default_branch:'main'};
  else if(url==='https://api.github.com/repos/'+repo+'/git/ref/heads/main')
   payload={object:{sha:mainSha}};
  else throw Error('unexpected provider path');
  return new Response(JSON.stringify(payload),{status:200,
   headers:{'content-type':'application/json'}});
 };
 try{
  const denied=await tool.handler({url:'https://evil.example'}, {config});
  assert.equal(denied.ok,false);
  assert.equal(calls.length,0,'invalid MCP input must not reach an external API');
  const result=await tool.handler({}, {config});
  assert.equal(result.ok,true);
  assert.equal(result.readOnly,true);
  assert.equal(result.paidSpendCents,0);
  assert.equal(result.repository,repo);
  assert.equal(result.sha,mainSha);
  assert.equal(result.visibility,'private');
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.method==='GET'&&c.authProvided));
 }finally{globalThis.fetch=original;}
});

test('Mahoraga MCP read tool fails closed without authenticated binding',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_mahoraga_repo.js',
  import.meta.url),'utf8');
 const helper=new URL('../cloud/hatchable/lib/mahoraga-actions.js',import.meta.url).href;
 const {default:tool}=await import('data:text/javascript;base64,'+
  Buffer.from(source.replace("'lib/mahoraga-actions.js'",JSON.stringify(helper))).toString('base64'));
 let externalCalls=0;
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{externalCalls++;throw Error('should not call provider');};
 try{
  const result=await tool.handler({}, {config:{get:async()=>null}});
  assert.equal(result.ok,false);
  assert.equal(result.status,'held');
  assert.equal(externalCalls,0);
 }finally{globalThis.fetch=original;}
});
