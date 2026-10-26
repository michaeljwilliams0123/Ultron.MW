import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function loadEndpoint({publicKey='{"kty":"EC","crv":"P-256"}',admitted=true,consumeThrows=false}={}){
 const raw=await readFile(new URL('../cloud/hatchable/api/brain/authority.js',import.meta.url),'utf8');
 const b64=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const platform=b64(`export const db={query:async()=>({rows:[]})};
export const config={get:async()=>globalThis.__testAdjudicator.publicKey};`);
 const validator=b64(`export async function verifyDelegatedGrant({request}){
 if(request?.operation==='forbidden')throw Error('grant-scope-mismatch');
 return {authorized:true,grantId:'signed-grant-test-123'};
}
export async function consumeDelegatedGrant(){
 if(globalThis.__testAdjudicator.consumeThrows)throw Error('simulated-driver-unavailable');
 return globalThis.__testAdjudicator.admitted
 ?{ok:true,grantId:'signed-grant-test-123',receiptId:55}
 :{ok:false,error:'grant-replayed'};
}`);
 const source=raw.replace("from 'hatchable'","from '"+platform+"'")
  .replace("from 'lib/security-adjudicator.js'","from '"+validator+"'");
 const module=await import(b64(source)+'#'+Math.random());
 globalThis.__testAdjudicator={publicKey,admitted,consumeThrows};
 return module;
}
function response(){
 return {code:200,status(n){this.code=n;return this;},json(body){return {status:this.code,body};}};
}
test('delegated authority endpoint is admin-only and POST-only',async()=>{
 const endpoint=await loadEndpoint();
 assert.equal(endpoint.access,'admin');
 assert.deepEqual(endpoint.methods,['POST']);
 delete globalThis.__testAdjudicator;
});
test('missing security-service public key holds before consuming any capability',async()=>{
 const e=await loadEndpoint({publicKey:null});
 const r=await e.default({body:{request:{operation:'repo.inspect'}}},response());
 assert.equal(r.status,503);
 assert.equal(r.body.error,'adjudicator-unconfigured');
 delete globalThis.__testAdjudicator;
});
test('signed delegated grant admission records only a sanitized receipt',async()=>{
 const e=await loadEndpoint();
 const r=await e.default({body:{request:{operation:'repo.inspect'},envelope:{payload:'sensitive'}}},response());
 assert.equal(r.status,201);
 assert.deepEqual(r.body,{schema:'ultron.authority-admission.v1',
  ok:true,grantId:'signed-grant-test-123',receiptId:55,
  status:'admitted-not-executed'});
 assert.equal(JSON.stringify(r.body).includes('sensitive'),false);
 delete globalThis.__testAdjudicator;
});
test('invalid scope is rejected without presenting the grant as authorized',async()=>{
 const e=await loadEndpoint();
 const r=await e.default({body:{request:{operation:'forbidden'},envelope:{}}},response());
 assert.equal(r.status,403);
 assert.equal(r.body.ok,false);
 delete globalThis.__testAdjudicator;
});
test('replayed grant is a conflict and does not gain execution authority',async()=>{
 const e=await loadEndpoint({admitted:false});
 const r=await e.default({body:{request:{operation:'repo.inspect'},envelope:{}}},response());
 assert.equal(r.status,409);
 assert.equal(r.body.error,'grant-replayed');
 delete globalThis.__testAdjudicator;
});

test('database consumption failure reports temporary unavailability, not invalid identity',async()=>{
 const e=await loadEndpoint({consumeThrows:true});
 const r=await e.default({body:{request:{operation:'repo.inspect'},envelope:{}}},response());
 assert.equal(r.status,503);
 assert.equal(r.body.error,'authority-ledger-unavailable');
 delete globalThis.__testAdjudicator;
});
