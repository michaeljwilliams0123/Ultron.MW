import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';

globalThis.crypto??=webcrypto;
const source=await readFile(new URL('../cloud/hatchable/lib/mcp-signed-note.js',import.meta.url),'utf8');
const transformed=source
 .replace("'lib/cloud-native-action.js'",JSON.stringify(new URL('../cloud/hatchable/lib/cloud-native-action.js',import.meta.url).href))
 .replace("'lib/security-adjudicator.js'",JSON.stringify(new URL('../cloud/hatchable/lib/security-adjudicator.js',import.meta.url).href));
const {prepareSignedNote,executeSignedNote,reconcileSignedNote}=await import(
 'data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const request=()=>({key:'cloud:note:signed-test',kind:'goal',body:'A bounded goal',
 expectedProfileVersion:2,expectedStopVersion:3});
const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const publicJwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
const config={get:async()=>JSON.stringify(publicJwk)};
async function envelope(input,changes={}){
 const prepared=await prepareSignedNote(input);
 const now=Date.now();
 const payload=JSON.stringify({
  schema:'ultron.security-grant.v1',issuer:'ultron-independent-security',
  audience:'ultron-cloud-brain',grantId:'test-signed-grant-01',
  policySha:'a'.repeat(64),notBefore:new Date(now-1000).toISOString(),
  expiresAt:new Date(now+60000).toISOString(),...prepared.grantRequest,...changes
 });
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
  keys.privateKey,new TextEncoder().encode(payload));
 return {payload,signature:Buffer.from(signature).toString('base64url')};
}
function harness({lostAck=false,deny=false}={}){
 let row=null,writes=0,reads=0;
 return {get writes(){return writes;},get reads(){return reads;},db:{async query(sql,p){
  if(sql.includes('LEFT JOIN brain_events')){
   reads++;
   return {rows:row?[row]:[]};
  }
  assert.match(sql,/INSERT INTO brain_authority_grants/);
  assert.match(sql,/INSERT INTO brain_notes/);
  assert.match(sql,/INSERT INTO brain_events/);
  assert.match(sql,/FOR SHARE/);
  assert.match(sql,/clock_timestamp\(\)/);
  assert.match(sql,/max_paid_cents=0/);
  writes++;
  if(deny)return {rows:[]};
  row={id:4,kind:p[2],body:p[3],fingerprint:p[1],receiptId:9,grantId:p[6]};
  if(lostAck)throw Error('lost response');
  return {rows:[{id:4,receiptId:9}]};
 }}};
}
test('signed note binds the exact normalized payload and writes once',async()=>{
 const h=harness(),input=request(),token=await envelope(input);
 const result=await executeSignedNote({db:h.db,config,request:input,envelope:token});
 assert.equal(result.status,'completed');
 assert.equal(result.reused,false);
 const again=await executeSignedNote({db:h.db,config,request:input,envelope:token});
 assert.equal(again.reused,true);
 assert.equal(h.writes,1);
 const changed=await executeSignedNote({db:h.db,config,
  request:{...input,body:'different'},envelope:token});
 assert.equal(changed.reason,'grant-invalid-or-expired');
 assert.equal(h.writes,1);
});
test('lost acknowledgement is reconciled without another write',async()=>{
 const h=harness({lostAck:true}),input=request(),token=await envelope(input);
 const result=await executeSignedNote({db:h.db,config,request:input,envelope:token});
 assert.equal(result.status,'completed');
 assert.equal(result.reused,true);
 const recovered=await reconcileSignedNote({db:h.db,request:input,grantId:'test-signed-grant-01'});
 assert.equal(recovered.status,'completed');
 assert.equal(h.writes,1);
});
test('unverified, expired, wrong-scope and absent authority cannot write',async()=>{
 const input=request();
 for(const token of [
  await envelope(input,{operation:'repo.inspect'}),
  await envelope(input,{expiresAt:new Date(Date.now()-100).toISOString(),
   notBefore:new Date(Date.now()-10000).toISOString()}),
  {payload:'{}',signature:'invalid'}
 ]){
  const h=harness();
  assert.equal((await executeSignedNote({db:h.db,config,request:input,envelope:token})).status,'held');
  assert.equal(h.writes,0);
 }
 const h=harness();
 assert.equal((await executeSignedNote({db:h.db,config:{get:async()=>null},
  request:input,envelope:await envelope(input)})).reason,'adjudicator-unconfigured');
 assert.equal(h.writes,0);
});
test('missing authority or absent receipt remains unresolved, never success',async()=>{
 const h=harness({deny:true}),input=request(),token=await envelope(input);
 const result=await executeSignedNote({db:h.db,config,request:input,envelope:token});
 assert.equal(result.status,'reconcile-required');
 assert.equal((await reconcileSignedNote({db:h.db,request:input,
  grantId:'test-signed-grant-01'})).status,'reconcile-required');
 assert.equal(h.writes,1);
});
test('unavailable readback does not attempt a mutation',async()=>{
 let writes=0;
 const db={async query(sql){
  if(sql.includes('INSERT INTO brain_authority_grants'))writes++;
  throw Error('database unavailable');
 }};
 const input=request();
 const result=await executeSignedNote({db,config,request:input,envelope:await envelope(input)});
 assert.equal(result.reason,'readback-unavailable');
 assert.equal(writes,0);
});
test('MCP remember routes prepare and reconcile without dispatching',async()=>{
 const handlerSource=await readFile(new URL('../cloud/hatchable/mcp/ultron_remember.js',import.meta.url),'utf8');
 const alias='data:text/javascript;base64,'+Buffer.from(
  `export const prepareSignedNote=async()=>({prepared:true});
   export const reconcileSignedNote=async()=>({reconciled:true});
   export const executeSignedNote=async()=>({executed:true});`
 ).toString('base64');
 const handler=await import('data:text/javascript;base64,'+Buffer.from(
  handlerSource.replace("'lib/mcp-signed-note.js'","'"+alias+"'")).toString('base64'));
 assert.equal(handler.access,'admin');
 assert.deepEqual(await handler.default.handler({mode:'prepare',request:request()},{}),{prepared:true});
 assert.deepEqual(await handler.default.handler({mode:'reconcile',request:request()},{}),{reconciled:true});
 assert.deepEqual(await handler.default.handler({mode:'submit',request:request()},{}),{executed:true});
 assert.equal((await handler.default.handler({mode:'invalid'},{})).status,'held');
});
