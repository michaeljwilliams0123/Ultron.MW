import test from 'node:test';
import assert from 'node:assert/strict';
import {createGraphWorkbookReader} from '../cloud/hatchable/lib/graph-workbook-read.js';
const binding={accountId:'owner-id',itemId:'item-id',worksheetId:'sheet-id',allowedCells:['A1']};
function make(transport,overrides={}){
 return createGraphWorkbookReader({...binding,getDelegatedToken:async()=> 'delegated-token',
  transport,...overrides});
}
test('reads only a configured cell after Graph confirms the account',async()=>{
 const calls=[];
 const reader=make(async(url,init)=>{
  calls.push({url,init});
  return new Response(JSON.stringify(calls.length===1?{id:'owner-id'}:{values:[[42]]}));
 });
 assert.deepEqual(await reader.readCell('A1'),{ok:true,cell:'A1',value:42});
 assert.equal(calls.length,2);
 assert.match(calls[1].url,/\/me\/drive\/items\/item-id\/workbook\/worksheets\/sheet-id\/range/);
 assert.equal(calls[1].init.method,'GET');
 assert.equal(calls[1].init.redirect,'error');
});
test('denies unconfigured cells and account mismatches without workbook access',async()=>{
 let calls=0;
 const reader=make(async()=>{calls++;return new Response(JSON.stringify({id:'other'}));});
 assert.equal((await reader.readCell('B2')).error,'graph-cell-not-admitted');
 assert.equal(calls,0);
 assert.equal((await reader.readCell('A1')).error,'graph-account-mismatch');
 assert.equal(calls,1);
});
test('rejects unsafe configuration and missing tokens',async()=>{
 assert.throws(()=>make(fetch,{itemId:'../../me'}),/binding-invalid/);
 assert.throws(()=>make(fetch,{allowedCells:['XFE1']}),/binding-invalid/);
 assert.throws(()=>make(fetch,{allowedCells:['A1048577']}),/binding-invalid/);
 const reader=make(async()=>{throw Error('must not fetch');},{getDelegatedToken:async()=>null});
 assert.equal((await reader.readCell('A1')).error,'graph-delegated-token-unavailable');
});
test('rejects malformed or oversized provider results',async()=>{
 let calls=0;
 const reader=make(async()=>new Response(JSON.stringify(++calls===1?{id:'owner-id'}:{values:[[1,2]]})));
 assert.equal((await reader.readCell('A1')).error,'graph-response-invalid');
 const oversized=make(async()=>new Response('x'.repeat(65537)));
 assert.equal((await oversized.readCell('A1')).error,'graph-read-unavailable');
});
