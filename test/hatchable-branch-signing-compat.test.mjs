import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPublicKey,createVerify} from 'node:crypto';
import {APP,canary,github} from './helpers/github-branch-canary-fixture.mjs';

// Platform contract: the Hatchable native crypto bridge has no createSign.
// The existing isolated RS256 signer is available as lib/rsa-pkcs1-sign.js.
test('Hatchable branch canary loads without unsupported createSign import',async()=>{
 const source=await readFile(
  new URL('../cloud/hatchable/lib/github-branch-canary.js',import.meta.url),'utf8');
 const imports=source.match(/import\s*\{([^}]+)\}\s*from\s*'node:crypto'/);
 assert.ok(imports,'expected explicit platform crypto import');
 assert.doesNotMatch(imports[1],/\bcreateSign\b/,
  'Hatchable does not export createSign from node:crypto');
});

test('branch identity exchanges a real RS256 JWT with exact repo scope',async()=>{
 const gh=github();
 let signedRequests=0;
 const identity=canary.createBranchIdentity({appCredentials:APP,
  fetchImpl:async(url,options)=>{
   assert.match(url,/\/app\/installations\/179066535\/access_tokens$/);
   const auth=options.headers?.Authorization;
   assert.match(auth,/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
   const jwt=auth.slice(7).split('.');
   assert.deepEqual(JSON.parse(Buffer.from(jwt[0],'base64url').toString()),{alg:'RS256',typ:'JWT'});
   const claims=JSON.parse(Buffer.from(jwt[1],'base64url').toString());
   assert.equal(claims.iss,'5633654');
   assert.ok(claims.exp>claims.iat&&claims.exp-claims.iat<=600);
   const verifier=createVerify('RSA-SHA256');
   verifier.update(jwt[0]+'.'+jwt[1]);
   assert.equal(verifier.verify(createPublicKey(APP.privateKey),
    Buffer.from(jwt[2],'base64url')),true,'JWT must verify under the App key');
   const body=JSON.parse(options.body);
   assert.deepEqual(body.repository_ids,[1424939667]);
   assert.deepEqual(body.permissions,signedRequests===0
    ?{contents:'write',metadata:'read'}:{contents:'read',metadata:'read'});
   signedRequests++;
   return gh.fetchImpl(url,options);
  },clock:()=>Date.now()});
 assert.equal(await identity.getTokenForScope('repair.branch.create'),'scoped-write-token');
 assert.equal(await identity.getReadToken(),'scoped-read-token');
 assert.equal(signedRequests,2);
 assert.equal(gh.posts('/git/commits'),0);
 assert.equal(gh.posts('/git/refs'),0);
});
