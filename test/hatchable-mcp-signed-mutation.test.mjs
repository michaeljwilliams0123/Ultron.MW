import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
globalThis.crypto??=webcrypto;
const source=await readFile(new URL('../cloud/hatchable/lib/mcp-signed-mutation.js',import.meta.url),'utf8');
const transformed=source
 .replace("'lib/security-adjudicator.js'",JSON.stringify(new URL('../cloud/hatchable/lib/security-adjudicator.js',import.meta.url).href))
 .replace("'lib/owner-live-events.js'",JSON.stringify(new URL('../cloud/hatchable/lib/owner-live-events.js',import.meta.url).href));
const {prepareMutation,executeMutation,reconcileMutation}=await import(
 'data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const config={get:async()=>JSON.stringify(await webcrypto.subtle.exportKey('jwk',pair.publicKey))};
const queue=()=>({operation:'mcp.queue.submit',key:'test-key-001',objective:'repo.inspect',
 expectedProfileVersion:2,expectedStopVersion:3});
const control=()=>({operation:'mcp.task.control',key:'test-key-002',action:'cancel',id:9,
 expectedProfileVersion:2,expectedStopVersion:3});
async function sign(request,changes={}){
 const {grantRequest}=await prepareMutation(request),now=Date.now();
 const payload=JSON.stringify({schema:'ultron.security-grant.v1',issuer:'ultron-independent-security',
  audience:'ultron-cloud-brain',grantId:'test-mutation-grant',policySha:'a'.repeat(64),
  notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
  ...grantRequest,...changes});
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(payload));
 return {payload,signature:Buffer.from(signature).toString('base64url')};
}
function harness({lost=false,deny=false}={}){
 let row,writes=0,reads=0;
 return {get writes(){return writes;},get reads(){return reads;},db:{async query(sql,p){
  if(sql.includes('FROM brain_mcp_mutations m')){reads++;return {rows:row?[row]:[]};}
  assert.match(sql,/INSERT INTO brain_authority_grants/);
  assert.match(sql,/INSERT INTO brain_mcp_mutations/);
  assert.match(sql,/INSERT INTO brain_events/);
  assert.match(sql,/NOT paused AND max_paid_cents=0/);
  assert.match(sql,/clock_timestamp\(\)/);
  writes++;
  if(deny)return {rows:[]};
  row={fingerprint:p[1],operation:p[2],grant_id:p[6],receiptId:12,outcome:'applied',taskId:9};
  if(lost)throw Error('response lost');
  return {rows:[{receiptId:12}]};
 }}};
}
for(const factory of [queue,control]){
 test(`signed ${factory.name} binds exact request and never replays`,async()=>{
  const h=harness(),request=factory(),token=await sign(request);
  assert.equal((await executeMutation({db:h.db,config,request,envelope:token})).status,'applied');
  assert.equal((await executeMutation({db:h.db,config,request,envelope:token})).reused,true);
  const altered={...request,expectedStopVersion:4};
  assert.equal((await executeMutation({db:h.db,config,request:altered,envelope:token})).reason,'grant-invalid-or-expired');
  assert.equal(h.writes,1);
 });
}
test('lost acknowledgement reconciles without resending',async()=>{
 const h=harness({lost:true}),request=control(),token=await sign(request);
 assert.equal((await executeMutation({db:h.db,config,request,envelope:token})).reused,true);
 assert.equal((await reconcileMutation({db:h.db,request,grantId:'test-mutation-grant'})).status,'applied');
 assert.equal(h.writes,1);
});
test('missing policy, forged grant, and unresolved state fail closed',async()=>{
 const request=queue(),h=harness({deny:true});
 assert.equal((await executeMutation({db:h.db,config,request,envelope:await sign(request)})).status,'reconcile-required');
 assert.equal((await reconcileMutation({db:h.db,request,grantId:'test-mutation-grant'})).status,'reconcile-required');
 const forged=harness();
 assert.equal((await executeMutation({db:forged.db,config,request,envelope:await sign(request,{resource:'sha256:'+ '0'.repeat(64)})})).status,'held');
 assert.equal(forged.writes,0);
 assert.equal((await prepareMutation({...request,objective:'council.room'})).status,'held');
 assert.equal((await prepareMutation({...control(),action:'shell'})).status,'held');
});
test('readback conflicts and denied transition never appear successful',async()=>{
 const request=control(),token=await sign(request);
 const readback={fingerprint:'0'.repeat(64),operation:request.operation,
  grant_id:'test-mutation-grant',receiptId:1,outcome:'applied',taskId:9};
 const db={query:async()=>({rows:[readback]})};
 assert.equal((await executeMutation({db,config,request,envelope:token})).reason,'idempotency-conflict');
 const prepared=await prepareMutation(request);
 readback.fingerprint=prepared.grantRequest.resource.slice(7);
 readback.outcome='denied';readback.taskId=null;
 const result=await reconcileMutation({db,request,grantId:'test-mutation-grant'});
 assert.equal(result.status,'denied');
 assert.equal(result.ok,false);
});
