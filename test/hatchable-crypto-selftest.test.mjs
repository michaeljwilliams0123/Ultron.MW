import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{access,methods,runPublicCryptoSelftest}
 from '../cloud/hatchable/api/brain/crypto-verify-selftest.js';
function mock(){
 return {statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(code){this.statusCode=code;return this},
  json(body){this.body=body;return this}};
}
test('self-test is admin only and uses a fixed disposable vector',async()=>{
 assert.equal(access,'admin');assert.deepEqual(methods,['GET']);
 const anonymous=mock();
 await handler({member:{handle:'other'},method:'GET'},anonymous);
 assert.equal(anonymous.statusCode,403);
 assert.equal(anonymous.body.reason,'owner-identity-required');
 const owner=mock();
 await handler({member:{handle:'michaeljwilliams0123'},method:'GET'},owner);
 assert.equal(owner.statusCode,200);
 assert.equal(owner.body.results.length,21);\n assert.deepEqual(owner.body.results.slice(0,3).map(x=>x.case),['base64-string','buffer','uint8array']);\n assert.ok(owner.body.results.slice(0,3).every(x=>x.algorithm==='sha256'));
 assert.ok(owner.body.results.slice(0,3).every(x=>x.verified===true));
 assert.equal(owner.headers['Cache-Control'],'private, no-store');
 assert.equal(JSON.stringify(owner.body).includes('PRIVATE KEY'),false);
});
