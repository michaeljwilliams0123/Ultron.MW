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
  assert.equal((await tool.handler([], {config})).ok,true);
  const before=calls.length;
  assert.equal((await tool.handler(['unexpected'], {config})).reason,'invalid-arguments');
  assert.equal(calls.length,before);
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

test('native Mahoraga App mode obtains only a read-scoped installation token before two repository GETs',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');
 const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
 const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_mahoraga_repo.js',import.meta.url),'utf8');
 const helper=new URL('../cloud/hatchable/lib/mahoraga-actions.js',import.meta.url).href;
 const {default:tool}=await import('data:text/javascript;base64,'+
  Buffer.from(source.replace("'lib/mahoraga-actions.js'",JSON.stringify(helper))).toString('base64'));
 const calls=[],original=globalThis.fetch;
 const config={get:async name=>({
  ULTRON_MAHORAGA_CREDENTIAL_MODE:'app',
  ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID:'Iv1.testappclient',
  ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID:'123456',
  ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY:privateKey
 })[name]??null};
 globalThis.fetch=async(url,options)=>{
  calls.push({url,method:options.method});
  let body;
  if(url==='https://api.github.com/app/installations/123456/access_tokens'){
   assert.equal(options.method,'POST','App token exchange is required for auth');
   assert.deepEqual(JSON.parse(options.body),{repository_ids:[1343333190],
    permissions:{contents:'read'}},
    'read-only MCP must request a read-only installation token');
   body={token:'ghs_test_only_token_1234567890123456',
    expires_at:new Date(Date.now()+600000).toISOString(),
    repositories:[{id:1343333190,full_name:repo}],
    permissions:{contents:'read',metadata:'read'}};
  }else if(url==='https://api.github.com/repos/'+repo){
   assert.equal(options.method,'GET');body={id:1343333190,full_name:repo,private:true,default_branch:'main'};
  }else if(url==='https://api.github.com/repos/'+repo+'/git/ref/heads/main'){
   assert.equal(options.method,'GET');body={object:{sha:mainSha}};
  }else throw Error('unexpected provider endpoint');
  return new Response(JSON.stringify(body),{status:200});
 };
 try{
  const result=await tool.handler({}, {config});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.sha,mainSha);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET','GET']);
  assert.equal(calls.filter(c=>c.url.includes('/repos/'+repo)&&c.method==='POST').length,0);
 }finally{globalThis.fetch=original;}
});

test('Mahoraga MCP rejects an over-scoped App token before repository reads',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');
 const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
 const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_mahoraga_repo.js',import.meta.url),'utf8');
 const helper=new URL('../cloud/hatchable/lib/mahoraga-actions.js',import.meta.url).href;
 const {default:tool}=await import('data:text/javascript;base64,'+
  Buffer.from(source.replace("'lib/mahoraga-actions.js'",JSON.stringify(helper))).toString('base64'));
 let attempts=0;const original=globalThis.fetch;
 const config={get:async name=>({
  ULTRON_MAHORAGA_CREDENTIAL_MODE:'app',
  ULTRON_MAHORAGA_GITHUB_APP_CLIENT_ID:'Iv1.testappclient',
  ULTRON_MAHORAGA_GITHUB_APP_INSTALLATION_ID:'123456',
  ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY:privateKey
 })[name]??null};
 globalThis.fetch=async(url,options)=>{
  attempts++;
  assert.equal(url,'https://api.github.com/app/installations/123456/access_tokens');
  assert.equal(options.method,'POST');
  return new Response(JSON.stringify({
   token:'ghs_test_only_token_1234567890123456',
   expires_at:new Date(Date.now()+600000).toISOString(),
   repositories:[{id:1343333190,full_name:repo}],
   permissions:{contents:'read',metadata:'read',issues:'write'}
  }),{status:200});
 };
 try{
  const denied=await tool.handler({}, {config});
  assert.equal(denied.ok,false);
  assert.equal(denied.status,'held');
  assert.equal(attempts,1,'over-scoped token must be refused before repo GETs');
 }finally{globalThis.fetch=original;}
});
