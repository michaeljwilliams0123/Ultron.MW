import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,graph,graphModule,makeTool} from './helpers/mcp-provider-fixture.mjs';

const request=()=>({key:'graph-write-001',cell:'A1',expectedBefore:1,value:2,
 expectedProfileVersion:2,expectedStopVersion:3});
test('Graph MCP signed write uses configured account and returns ledger-backed readback',async t=>{
 const h=await fixture(),value=request(),calls=[],original=globalThis.fetch;
 let cell=1;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init)=>{
  calls.push({url,method:init.method});
  if(init.method==='PATCH'){cell=2;return new Response('{}');}
  return new Response(JSON.stringify(url.endsWith('/me?$select=id')?{id:'owner-id'}:{values:[[cell]]}));
 };
 const tool=await makeTool('mcp/ultron_graph_workbook_write.js',"'lib/mcp-graph-write.js'",graphModule);
 const prepared=await tool.handler({mode:'prepare',request:value},{config:h.config});
 const envelope=await h.sign(prepared.grantRequest);
 const execute=()=>tool.handler({mode:'submit',request:value,envelope},h);
 assert.equal((await execute()).status,'observed');
 assert.equal((await execute()).status,'observed');
 assert.equal(calls.filter(x=>x.method==='PATCH').length,1);
 assert.equal((await tool.handler({mode:'reconcile',request:value,grantId:'test-provider-grant'},h)).status,'observed');
});
test('Graph timeout records unresolved state and cannot retry automatically',async t=>{
 const h=await fixture(),value=request(),original=globalThis.fetch;
 let patches=0;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init)=>{
  if(init.method==='PATCH'){patches++;throw Error('lost response');}
  return new Response(JSON.stringify(url.endsWith('/me?$select=id')?{id:'owner-id'}:{values:[[1]]}));
 };
 const prepared=await graph.graphWrite({mode:'prepare',request:value,config:h.config});
 const envelope=await h.sign(prepared.grantRequest);
 const submit=()=>graph.graphWrite({mode:'submit',request:value,envelope,db:h.db,config:h.config});
 assert.equal((await submit()).status,'reconcile-required');
 assert.equal((await submit()).status,'reconcile-required');
 assert.equal(h.row.status,'reconcile-required');
 assert.equal(patches,1);
 const changed={...value,value:3};
 assert.equal((await graph.graphWrite({mode:'submit',request:changed,envelope,db:h.db,
  config:h.config})).reason,'grant-invalid-or-expired');
});
test('Graph MCP rejects unconfigured cells and caller-supplied target overrides',async()=>{
 const h=await fixture();
 assert.equal((await graph.graphWrite({mode:'prepare',request:{...request(),cell:'B2'},
  config:h.config})).status,'held');
 assert.equal((await graph.graphWrite({mode:'prepare',request:{...request(),itemId:'other'},
  config:h.config})).status,'held');
});
