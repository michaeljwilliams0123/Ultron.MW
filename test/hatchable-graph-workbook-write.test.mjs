import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../cloud/hatchable/lib/graph-workbook-write.js',import.meta.url),'utf8');
const transformed=source.replace("'lib/graph-workbook-read.js'",
 JSON.stringify(new URL('../cloud/hatchable/lib/graph-workbook-read.js',import.meta.url).href));
const {createGraphWorkbookWriter}=await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const binding={accountId:'owner-id',itemId:'item-id',worksheetId:'sheet-id',allowedCells:['A1']};
const request=()=>({key:'graph-action-001',cell:'A1',expectedBefore:1,value:2});
function fixture({lost=false,claim=true,authority=true,record=true,account='owner-id',after=2}={}){
 const calls=[],claims=[],receipts=[];
 let cellReads=0;
 const transport=async(url,init)=>{
  calls.push({url,init});
  if(init.method==='PATCH'){
   if(lost)throw Error('lost response');
   return new Response('{}',{status:200});
  }
  if(url.endsWith('/me?$select=id'))return new Response(JSON.stringify({id:account}));
  return new Response(JSON.stringify({values:[[++cellReads===1?1:after]]}));
 };
 const writer=createGraphWorkbookWriter({...binding,transport,
  getDelegatedToken:async()=> 'delegated-token',
  claimDispatch:async input=>{claims.push(input);return claim;},
  canDispatch:async()=>authority,
  recordObservation:async input=>{receipts.push(input);return record;}});
 return {writer,calls,claims,receipts};
}
test('one bounded PATCH requires claim, provider acknowledgment and independent readback',async()=>{
 const h=fixture();
 const result=await h.writer.writeCell(request());
 assert.equal(result.status,'observed');
 assert.equal(h.claims.length,1);
 assert.equal(h.receipts.length,1);
 const writes=h.calls.filter(call=>call.init.method==='PATCH');
 assert.equal(writes.length,1);
 assert.equal(writes[0].init.redirect,'error');
 assert.deepEqual(JSON.parse(writes[0].init.body),{values:[[2]]});
 assert.match(writes[0].url,/\/item-id\/workbook\/worksheets\/sheet-id\/range/);
 assert.equal(JSON.stringify(result).includes('delegated-token'),false);
});
test('claim denial, account mismatch, precondition mismatch and unsafe input prevent PATCH',async()=>{
 for(const [options,value] of [
  [{claim:false},request()],[{account:'other'},request()],
  [{},{...request(),expectedBefore:7}],[{},{...request(),cell:'B1'}],
  [{},{...request(),value:'=1+1'}],[{},{...request(),value:' +1'}]
 ]){
  const h=fixture(options),result=await h.writer.writeCell(value);
  assert.equal(result.status,'held');
  assert.equal(h.calls.filter(call=>call.init.method==='PATCH').length,0);
 }
});
test('lost PATCH response and readback failures remain uncertain without replay',async()=>{
 for(const options of [{lost:true},{after:3},{record:false},{authority:false}]){
  const h=fixture(options),result=await h.writer.writeCell(request());
  assert.equal(result.status,'reconcile-required');
  assert.ok(h.calls.filter(call=>call.init.method==='PATCH').length<=1);
  if(options.lost)assert.equal(h.receipts.length,0);
 }
});
test('claim identity binds target, old value and new value, and cannot be mutated',async()=>{
 const h=fixture();
 await h.writer.writeCell(request());
 assert.equal(Object.isFrozen(h.claims[0]),true);
 assert.match(h.claims[0].fingerprint,/^[a-f0-9]{64}$/);
 const second=fixture();
 await second.writer.writeCell({...request(),value:3});
 assert.notEqual(h.claims[0].fingerprint,second.claims[0].fingerprint);
 assert.throws(()=>createGraphWorkbookWriter({...binding}),/authority-unavailable/);
});
test('a durable one-shot claim prevents concurrent or repeated dispatch',async()=>{
 let claimed=false,writes=0,cell=1;
 const writer=createGraphWorkbookWriter({...binding,getDelegatedToken:async()=> 'delegated-token',
  claimDispatch:async()=>{if(claimed)return false;claimed=true;return true;},
  canDispatch:async()=>true,recordObservation:async()=>true,
  transport:async(url,init)=>{
   if(init.method==='PATCH'){writes++;cell=2;return new Response('{}');}
   if(url.endsWith('/me?$select=id'))return new Response(JSON.stringify({id:'owner-id'}));
   return new Response(JSON.stringify({values:[[cell]]}));
  }});
 const outcomes=await Promise.all([writer.writeCell(request()),writer.writeCell(request())]);
 assert.equal(writes,1);
 assert.equal(outcomes.filter(result=>result.status==='observed').length,1);
 assert.ok(['held','reconcile-required'].includes(outcomes.find(result=>!result.ok).status));
 assert.equal((await writer.writeCell(request())).status,'held');
 assert.equal(writes,1);
});
test('claim loss and accessor input never initiate a provider mutation',async()=>{
 const h=fixture();
 const bad=request();
 Object.defineProperty(bad,'value',{enumerable:true,get:()=>2});
 assert.equal((await h.writer.writeCell(bad)).reason,'invalid-request');
 assert.equal(h.calls.length,0);
 const writer=createGraphWorkbookWriter({...binding,getDelegatedToken:async()=> 'delegated-token',
  claimDispatch:async()=>{throw Error('lost claim response');},
  canDispatch:async()=>true,recordObservation:async()=>true,
  transport:async(url,init)=>{
   assert.notEqual(init.method,'PATCH');
   return new Response(JSON.stringify(url.endsWith('/me?$select=id')?{id:'owner-id'}:{values:[[1]]}));
  }});
 assert.equal((await writer.writeCell(request())).reason,'dispatch-claim-unresolved');
});
