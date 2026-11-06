import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validateMahoragaAction} from '../cloud/hatchable/lib/mahoraga-actions.js';

globalThis.crypto??=webcrypto;
const source=await readFile(new URL('../cloud/hatchable/lib/mcp-mahoraga-grant.js',import.meta.url),'utf8');
const dependency='data:text/javascript;base64,'+Buffer.from(`
 export const validateMahoragaAction=globalThis.__mahoragaValidate;
 export const runMahoragaAction=async()=>({ok:true,state:'prepared'});
 export const mahoragaActionStatus=async()=>({ok:true,action:{state:'prepared'}});
`).toString('base64');
globalThis.__mahoragaValidate=validateMahoragaAction;
const transformed=source
 .replace("'lib/security-adjudicator.js'",JSON.stringify(new URL('../cloud/hatchable/lib/security-adjudicator.js',import.meta.url).href))
 .replace("'lib/mahoraga-actions.js'",JSON.stringify(dependency));
const {prepareMahoraga,submitMahoraga,reconcileMahoraga}=await import(
 'data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const config={get:async()=>JSON.stringify(await webcrypto.subtle.exportKey('jwk',pair.publicKey))};
const request=()=>({action:{key:'test:issue-123',operation:'issue.create',
 input:{title:'Title',body:'Body',expectedMainSha:'a'.repeat(40)}},
 expectedProfileVersion:2,expectedStopVersion:3});
async function sign(value,changes={}){
 const {grantRequest}=await prepareMahoraga(value),now=Date.now();
 const payload=JSON.stringify({schema:'ultron.security-grant.v1',issuer:'ultron-independent-security',
  audience:'ultron-cloud-brain',grantId:'test-grant-123',policySha:'a'.repeat(64),
  notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
  ...grantRequest,...changes});
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,
  new TextEncoder().encode(payload));
 return {payload,signature:Buffer.from(signature).toString('base64url')};
}
function harness({lost=false,deny=false}={}){
 let row,writes=0;
 return {get writes(){return writes;},db:{async query(sql,p){
  if(sql.includes('LEFT JOIN mahoraga_mcp_authority'))return {rows:row?[row]:[]};
  assert.match(sql,/INSERT INTO brain_authority_grants/);
  assert.match(sql,/INSERT INTO mahoraga_mcp_authority/);
  assert.match(sql,/INSERT INTO brain_events/);
  assert.match(sql,/NOT paused AND max_paid_cents=0/);
  assert.match(sql,/clock_timestamp\(\)/);
  writes++;
  if(deny)return {rows:[]};
  row={action_key:p[0],operation:p[1],request:JSON.parse(p[2]),state:'prepared',
   grant_id:p[3],fingerprint:p[10]};
  if(lost)throw Error('response lost');
  return {rows:[{id:1}]};
 }}};
}
test('signed action binds exact operation and atomically recovers lost admission acknowledgement',async()=>{
 const h=harness({lost:true}),value=request(),envelope=await sign(value);
 assert.equal((await submitMahoraga({db:h.db,config,request:value,envelope})).state,'prepared');
 assert.equal((await submitMahoraga({db:h.db,config,request:value,envelope})).state,'prepared');
 assert.equal((await reconcileMahoraga({db:h.db,request:value,grantId:'test-grant-123'})).action.state,'prepared');
 assert.equal(h.writes,1);
 const changed=request();changed.action.input.body='Changed';
 assert.equal((await submitMahoraga({db:h.db,config,request:changed,envelope})).reason,'grant-invalid-or-expired');
 assert.equal((await reconcileMahoraga({db:h.db,request:changed,grantId:'test-grant-123'})).reason,'idempotency-conflict');
});
test('missing policy, forged grant, unexpected fields and accessors fail closed',async()=>{
 const h=harness({deny:true}),value=request();
 assert.equal((await submitMahoraga({db:h.db,config,request:value,envelope:await sign(value)})).status,'reconcile-required');
 assert.equal((await reconcileMahoraga({db:h.db,request:value,grantId:'test-grant-123'})).status,'reconcile-required');
 assert.equal((await submitMahoraga({db:h.db,config,request:value,
  envelope:await sign(value,{resource:'sha256:'+'0'.repeat(64)})})).reason,'grant-invalid-or-expired');
 const extra=request();extra.action.input.ignored=true;
 assert.equal((await prepareMahoraga(extra)).status,'held');
 const getter=request();Object.defineProperty(getter,'expectedStopVersion',{enumerable:true,get:()=>3});
 assert.equal((await prepareMahoraga(getter)).status,'held');
 assert.equal(h.writes,1);
});
test('Verify dispatch is bound to the exact ref and head',async()=>{
 const value=request();value.action.operation='verify.dispatch';
 value.action.input={ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)};
 const first=await prepareMahoraga(value);
 assert.equal(first.grantRequest.operation,'repo.verify.dispatch');
 value.action.input.expectedHeadSha='c'.repeat(40);
 assert.notEqual((await prepareMahoraga(value)).grantRequest.resource,first.grantRequest.resource);
});
