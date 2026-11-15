import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateAppJwt, readConfiguration, verifySecondaryAdmin } from './verify-secondary-admin.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
assert.throws(() => readConfiguration({}), /Missing or invalid/);
assert.throws(() => readConfiguration({ SECONDARY_ADMIN_APP_ID: 'nope', SECONDARY_ADMIN_INSTALLATION_ID: '1', ULTRON_SECONDARY_ADMIN_PRIVATE_KEY: pem }), /Missing or invalid/);
const [header, payload, signature] = generateAppJwt('5722581', pem, 1_700_000_000).split('.');
assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: 1_699_999_940, exp: 1_700_000_540, iss: '5722581' });
assert.ok(signature.length > 0);
console.log('verify-secondary-admin unit tests passed');

const target={appId:'5722581',installationId:'181119149',privateKey:pem};
const goodToken={token:'mock-installation-token',expires_at:'2026-11-15T03:00:00Z',
  permissions:{contents:'read',metadata:'read'},repositories:[{id:1424939667}]};
const expectedRepo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const originalFetch=globalThis.fetch;
const ok=(data)=>({ok:true,status:200,json:async()=>data});
async function proveWithFixture(token,repo=expectedRepo){
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    return url.endsWith('/access_tokens')?ok(token):ok(repo);
  };
  try {return {result:await verifySecondaryAdmin(target),calls};}
  finally {globalThis.fetch=originalFetch;}
}
const valid=await proveWithFixture(goodToken);
assert.deepEqual(JSON.parse(valid.calls[0].options.body),{
  repositories:['Ultron.MW'],permissions:{contents:'read'}
},'minting is operation-downscoped, not a broad Admin token');
assert.equal(valid.calls.length,2);
assert.equal(valid.result.repositoryId,1424939667);
assert.equal(valid.calls[1].options.headers.Authorization,'Bearer mock-installation-token');

globalThis.fetch=async(url)=>url.endsWith('/access_tokens')
  ?ok({...goodToken,permissions:{contents:'write',metadata:'read'}})
  :ok(expectedRepo);
try {await assert.rejects(verifySecondaryAdmin(target),/permissions|scope/i);}
finally {globalThis.fetch=originalFetch;}

let leakedReadback=false;
globalThis.fetch=async(url)=>{
  if(url.endsWith('/access_tokens'))return ok({...goodToken,repositories:[{id:10000}]});
  leakedReadback=true;return ok(expectedRepo);
};
try {await assert.rejects(verifySecondaryAdmin(target),/repository|scope/i);}
finally {globalThis.fetch=originalFetch;}
assert.equal(leakedReadback,false,'wrong installation repository must be refused before readback');
