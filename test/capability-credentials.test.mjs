import test from 'node:test';
import assert from 'node:assert/strict';
import { createSigningKey,issueCapabilityToken,verifyCapabilityToken,
  validateSecretReference,credentialReadiness,CREDENTIAL_POLICY } from '../src/capability-credentials.mjs';
import { createApiHandler,createMcpHandler } from '../src/framework-integration-runtime.mjs';

const repository={
  full_name:'michaeljwilliams0123/Ultron.MW',private:false,default_branch:'main',
};
const mockGet=async path=>path.includes('/actions/runs')?
  {workflow_runs:[{id:2,head_sha:'a'.repeat(40),status:'completed',conclusion:'success'}]}:repository;

test('self-owned short-lived bearer tokens have scope, audience and expiry',()=>{
  const key=createSigningKey();
  assert.ok(key.length>=43);
  const token=issueCapabilityToken({key,audience:'ultronapi',
    scopes:['status:read'],now:100,ttlSeconds:300});
  assert.equal(verifyCapabilityToken(token,{key,audience:'ultronapi',
    now:200,requiredScope:'status:read'}),true);
  assert.equal(verifyCapabilityToken(token,{key,audience:'other',now:200}),false);
  assert.equal(verifyCapabilityToken(token,{key,audience:'ultronapi',now:401}),false);
  assert.equal(verifyCapabilityToken(token,{key,audience:'ultronapi',now:200,
    requiredScope:'ci:read'}),false);
  assert.equal(verifyCapabilityToken(token.slice(0,-2)+'zz',{
    key,audience:'ultronapi',now:200}),false);
  assert.equal(verifyCapabilityToken(token,{key:createSigningKey(),
    audience:'ultronapi',now:200}),false);
  assert.throws(()=>issueCapabilityToken({key,audience:'ultronapi',
    scopes:['admin:write']}),/Unsupported/);
  assert.throws(()=>issueCapabilityToken({key,audience:'ultronapi',
    ttlSeconds:86400}),/Unsupported/);
});
test('secret references reveal readiness, never values or third-party credentials',()=>{
  assert.deepEqual(validateSecretReference('env:ULTRON_TEST_SIGNING_KEY'),{
    source:'environment',name:'ULTRON_TEST_SIGNING_KEY',publicValue:null});
  assert.throws(()=>validateSecretReference('ghp_secret'),/environment-only/);
  assert.throws(()=>validateSecretReference('env:GITHUB_TOKEN'),/Invalid/);
  assert.throws(()=>validateSecretReference('env:ULTRON_TEST;echo leaked'),/Invalid/);
  const secret='not-for-any-public-artifact-do-not-expose!';
  const status=credentialReadiness(['env:ULTRON_TEST_SIGNING_KEY'],
    {ULTRON_TEST_SIGNING_KEY:secret});
  assert.equal(status[0].available,true);
  assert.ok(!JSON.stringify(status).includes(secret));
  assert.match(CREDENTIAL_POLICY.externalProviders,/owner-authorized/);
});
test('API generator requires scoped owner credential and returns sanitized data',async()=>{
  const key=createSigningKey();
  const handler=createApiHandler({kind:'api',name:'my-api',operations:['status','ci']},
    {key,githubGet:mockGet,now:100});
  assert.equal((await handler(new Request('https://example.net/v1/status'))).status,401);
  const statusToken=issueCapabilityToken({key,audience:'my-api',now:100});
  const bearer={Authorization:'Bearer '+statusToken};
  const result=await handler(new Request('https://example.net/v1/status',{headers:bearer}));
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.data.name,repository.full_name);
  assert.equal(data.verified,true);
  assert.equal((await handler(new Request('https://example.net/v1/ci',{
    headers:bearer}))).status,401);
  const ciToken=issueCapabilityToken({key,audience:'my-api',
    scopes:['ci:read'],now:100});
  assert.equal((await handler(new Request('https://example.net/v1/ci',{
    headers:{Authorization:'Bearer '+ciToken}}))).status,200);
  assert.equal((await handler(new Request('https://example.net/execute',{
    method:'POST',headers:bearer}))).status,404);
});
test('MCP adapter lists and executes only safe public GitHub read tools',async()=>{
  const handle=createMcpHandler({kind:'mcp',name:'my-mcp',operations:['status','ci']},
    {githubGet:mockGet});
  const init=await handle({jsonrpc:'2.0',id:1,method:'initialize'});
  assert.equal(init.result.serverInfo.name,'ultron-my-mcp');
  const listed=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.deepEqual(listed.result.tools.map(x=>x.name),
    ['ultron_status','ultron_ci']);
  const r=await handle({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'ultron_ci',arguments:{}}});
  assert.equal(r.result.isError,false);
  assert.equal(JSON.parse(r.result.content[0].text).runs[0].id,2);
  assert.equal((await handle({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'ultron_shell',arguments:{}}})).error.code,-32602);
  assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
  assert.throws(()=>createMcpHandler({kind:'mcp',name:'my-mcp',
    operations:['shell']}),/allowlisted/);
});
test('MCP adapter implements the stateless 2026-07-28 request contract',async()=>{
  const handle=createMcpHandler({kind:'mcp',name:'my-mcp',operations:['status','ci']},
    {githubGet:mockGet});
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{}};
  const discover=await handle({jsonrpc:'2.0',id:1,method:'server/discover',_meta:meta});
  assert.equal(discover.result.resultType,'complete');
  assert.deepEqual(discover.result.supportedVersions,
    ['2026-07-28','2025-06-18']);
  const listed=await handle({jsonrpc:'2.0',id:2,method:'tools/list',_meta:meta});
  assert.equal(listed.result.resultType,'complete');
  assert.equal(listed.result.cacheScope,'public');
  assert.equal(listed.result._meta['io.modelcontextprotocol/serverInfo'].name,'ultron-my-mcp');
  const called=await handle({jsonrpc:'2.0',id:3,method:'tools/call',_meta:meta,
    params:{name:'ultron_status',arguments:{}}});
  assert.equal(called.result.resultType,'complete');
  assert.equal(called.result.isError,false);
  const unsupported=await handle({jsonrpc:'2.0',id:4,method:'tools/list',_meta:{
    ...meta,'io.modelcontextprotocol/protocolVersion':'1900-01-01'}});
  assert.equal(unsupported.error.code,-32022);
  assert.deepEqual(unsupported.error.data.supported,['2026-07-28','2025-06-18']);
  const missingCapabilities=await handle({jsonrpc:'2.0',id:5,method:'tools/list',
    _meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}});
  assert.equal(missingCapabilities.error.code,-32602);
  const invalidMetadata=await handle({jsonrpc:'2.0',id:6,method:'tools/list',_meta:{
    'io.modelcontextprotocol/protocolVersion':20260728,
    'io.modelcontextprotocol/clientCapabilities':[]}});
  assert.equal(invalidMetadata.error.code,-32602);
  const noHandshake=await handle({jsonrpc:'2.0',id:7,method:'initialize',_meta:meta});
  assert.equal(noHandshake.error.code,-32601);
});
