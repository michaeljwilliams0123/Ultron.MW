import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../cloud/hatchable/mcp/ultron_graph_workbook.js',import.meta.url),'utf8');
const readerUrl=new URL('../cloud/hatchable/lib/graph-workbook-read.js',import.meta.url).href;
const transformed=source.replace("'lib/graph-workbook-read.js'",JSON.stringify(readerUrl));
const tool=(await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'))).default;
const binding={accountId:'owner-id',itemId:'item-id',worksheetId:'sheet-id',allowedCells:['A1']};

test('Graph MCP tool uses only server-configured binding and delegated token',async t=>{
 const original=globalThis.fetch,calls=[],keys=[];
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init)=>{
  calls.push({url,init});
  return new Response(JSON.stringify(calls.length===1?{id:'owner-id'}:{values:[[42]]}));
 };
 const ctx={config:{get:async key=>{
  keys.push(key);
  return key==='ULTRON_GRAPH_WORKBOOK_BINDING'?JSON.stringify(binding):'delegated-token';
 }}};
 assert.deepEqual(await tool.handler({cell:'A1'},ctx),{ok:true,cell:'A1',value:42});
 assert.deepEqual(keys,['ULTRON_GRAPH_WORKBOOK_BINDING','ULTRON_GRAPH_DELEGATED_TOKEN']);
 assert.equal(calls.length,2);
 assert.match(calls[1].url,/\/item-id\/workbook\/worksheets\/sheet-id\//);
 assert.equal(calls[1].init.redirect,'error');
 assert.equal(tool.inputSchema.additionalProperties,false);
 assert.equal((await tool.handler({cell:'A1',itemId:'other'},ctx)).error,'graph-request-invalid');
 assert.equal((await tool.handler({cell:'B2'},ctx)).error,'graph-cell-not-admitted');
 assert.equal(calls.length,2);
});

test('Graph MCP tool fails closed on absent or invalid trusted configuration',async()=>{
 assert.equal((await tool.handler({cell:'A1'},{})).error,'graph-binding-unavailable');
 for(const raw of ['{}',JSON.stringify({...binding,transport:'attacker'}),'not-json']){
  const result=await tool.handler({cell:'A1'},{config:{get:async()=>raw}});
  assert.equal(result.error,'graph-binding-unavailable');
 }
 const result=await tool.handler({cell:'A1'},{config:{get:async key=>
  key==='ULTRON_GRAPH_WORKBOOK_BINDING'?JSON.stringify(binding):null}});
 assert.equal(result.error,'graph-delegated-token-unavailable');
});
