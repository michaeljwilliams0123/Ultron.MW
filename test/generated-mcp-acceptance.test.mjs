import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler,integration } from '../src/generated/acceptance/mcp.mjs';
test('generated mcp-acceptance supports bounded MCP read tools',async()=>{
 const get=async path=>path.endsWith('/actions/runs?per_page=3')?{workflow_runs:[]}:
  {full_name:'michaeljwilliams0123/Ultron.MW',private:false,default_branch:'main'};
 const handle=createHandler({githubGet:get});
 const init=await handle({jsonrpc:'2.0',id:1,method:'initialize'});
 assert.equal(init.result.serverInfo.name,'ultron-acceptance');
 const list=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(list.result.tools.map(t=>t.name),['ultron_status','ultron_ci']);
 const read=await handle({jsonrpc:'2.0',id:3,method:'tools/call',
  params:{name:'ultron_status',arguments:{}}});
 assert.equal(read.result.isError,false);
 const denied=await handle({jsonrpc:'2.0',id:4,method:'tools/call',
  params:{name:'ultron_shell',arguments:{}}});
 assert.equal(denied.error.code,-32602);
 assert.equal(integration.kind,'mcp');
});
