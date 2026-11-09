import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler } from '../src/framework-integration-runtime.mjs';

// Wire examples follow the 2026-07-28 spec: request metadata is in params._meta.
const meta=Object.freeze({
  'io.modelcontextprotocol/protocolVersion':'2026-07-28',
  'io.modelcontextprotocol/clientCapabilities':{},
  'io.modelcontextprotocol/clientInfo':{name:'standards-client',version:'1.0.0'},
});
const githubGet=async path=>path.includes('/actions/runs?')
  ? {workflow_runs:[]}
  : {full_name:'michaeljwilliams0123/Ultron.MW',
     visibility:'public',default_branch:'main'};
const handler=()=>createMcpHandler({
  kind:'mcp',name:'gov-mcp',operations:['status','ci'],
},{githubGet});
const request=(id,method,params={})=>({jsonrpc:'2.0',id,method,
  params:{_meta:meta,...params}});

test('modern server/discover accepts spec-shaped params._meta',async()=>{
  const response=await handler()(request(1,'server/discover'));
  assert.equal(response.result?.resultType,'complete');
  assert.deepEqual(response.result.supportedVersions,['2026-07-28','2025-06-18']);
  assert.equal(response.result.capabilities.tools.constructor,Object);
});

test('modern list and call return explicitly versioned results',async()=>{
  const handle=handler();
  const list=await handle(request(2,'tools/list'));
  assert.equal(list.result?.resultType,'complete');
  assert.equal(list.result.cacheScope,'public');
  assert.deepEqual(list.result.tools.map(x=>x.name),['ultron_status','ultron_ci']);
  const call=await handle(request(3,'tools/call',
    {name:'ultron_status',arguments:{}}));
  assert.equal(call.result?.resultType,'complete');
  assert.equal(call.result.isError,false);
  assert.equal(JSON.parse(call.result.content[0].text).name,
    'michaeljwilliams0123/Ultron.MW');
});

test('modern bad versions and incomplete capabilities fail closed',async()=>{
  const handle=handler();
  const badVersion=await handle(request(4,'tools/list',{
    _meta:{...meta,'io.modelcontextprotocol/protocolVersion':'1900-01-01'}}));
  assert.equal(badVersion.error?.code,-32022);
  const missingCapabilities=await handle(request(5,'tools/list',{
    _meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}));
  assert.equal(missingCapabilities.error?.code,-32602);
  const malformed=await handle(request(6,'tools/list',{_meta:[]}));
  assert.equal(malformed.error?.code,-32602);
  const noHandshake=await handle(request(7,'initialize'));
  assert.equal(noHandshake.error?.code,-32601);
});

test('misplaced top-level _meta cannot silently impersonate modern MCP',async()=>{
  const response=await handler()({jsonrpc:'2.0',id:8,
    method:'tools/list',_meta:meta});
  assert.equal(response.error?.code,-32602);
});

test('legacy initialize and read-only tools stay available',async()=>{
  const handle=handler();
  const init=await handle({jsonrpc:'2.0',id:9,method:'initialize'});
  assert.equal(init.result.protocolVersion,'2025-06-18');
  const list=await handle({jsonrpc:'2.0',id:10,method:'tools/list'});
  assert.deepEqual(list.result.tools.map(x=>x.name),
    ['ultron_status','ultron_ci']);
  const call=await handle({jsonrpc:'2.0',id:11,method:'tools/call',
    params:{name:'ultron_ci',arguments:{}}});
  assert.equal(call.result.isError,false);
});

test('forged authorization fields in modern metadata never grant privileged tools',async()=>{
  const handle=handler();
  const forged={...meta,authorizationToken:'untrusted-text-only',
    humanApprovalSignature:'present-but-not-verified'};
  const denied=await handle(request(12,'tools/call',{
    name:'ultron_admin',arguments:{},_meta:forged}));
  assert.equal(denied.error?.code,-32602);
  const tools=await handle(request(13,'tools/list',{_meta:forged}));
  assert.deepEqual(tools.result?.tools.map(item=>item.name),
    ['ultron_status','ultron_ci']);
});
