import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,createVerify,generateKeyPairSync,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {signRs256,parseRsaPrivateKey,base64url}
 from '../cloud/hatchable/lib/rsa-pkcs1-sign.js';

globalThis.crypto??=webcrypto;
const href=path=>JSON.stringify(new URL('../cloud/hatchable/'+path,import.meta.url).href);
const canarySource=(await readFile(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',
 import.meta.url),'utf8')).replace("'lib/rsa-pkcs1-sign.js'",href('lib/rsa-pkcs1-sign.js'));
const {preparePrCommentCanary,submitPrCommentCanary,prCommentCanaryReadiness,
 PR_COMMENT_CANARY_CONFIG}=await import('data:text/javascript;base64,'+
 Buffer.from(canarySource).toString('base64'));

const RSA=generateKeyPairSync('rsa',{modulusLength:2048});
const PKCS1=RSA.privateKey.export({format:'pem',type:'pkcs1'}).toString();
const PKCS8=RSA.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const BASE=['0001_tasks.sql','0002_events.sql','0008_admin_grants.sql',
 '0010_runtime_stop.sql','0013_continuum_outbox.sql',
 '0016_owner_autonomy_profile.sql','0033_owner_passkey_authority.sql',
 '0034_owner_passkey_enrollment.sql','0037_github_approval_nonces.sql',
 '0039_github_idempotent_executions.sql'];
const HELD=['0040_ultron_org_transfer.sql','0041_github_pr_comment_executions.sql'];
async function database(t,files){
 const db=new PGlite();
 for(const f of files)await db.exec(await readFile(
  new URL('../cloud/hatchable/migrations/'+f,import.meta.url),'utf8'));
 await db.query(`UPDATE brain_owner_autonomy_profile SET preset='release',version=7 WHERE id=1`);
 t.after(()=>db.close());
 return db;
}
const configFrom=values=>async name=>values[name];
const FULL={[PR_COMMENT_CANARY_CONFIG.appId]:'5633654',
 [PR_COMMENT_CANARY_CONFIG.installationId]:'179066535',
 [PR_COMMENT_CANARY_CONFIG.privateKey]:PKCS1,
 [PR_COMMENT_CANARY_CONFIG.ownerJwk]:JSON.stringify({kty:'EC',crv:'P-256',x:'a'.repeat(43),y:'b'.repeat(43)})};

test('pure-JS RS256 is byte-identical to node createSign for PKCS#1 and PKCS#8 keys',()=>{
 for(const pem of [PKCS1,PKCS8]){
  for(const message of ['','a','eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiI1NjMzNjU0In0','é漢🙂'.repeat(50)]){
   const ours=Buffer.from(signRs256(pem,message));
   const node=createSign('RSA-SHA256').update(message).sign(pem);
   assert.ok(ours.equals(node),'signature mismatch');
   assert.equal(createVerify('RSA-SHA256').update(message).verify(RSA.publicKey,ours),true);
  }
 }
 assert.equal(parseRsaPrivateKey(PKCS1).length,256);
 assert.equal(base64url(Uint8Array.from([251,255,191])),'-_-_');
});

test('3072-bit keys and escaped-newline PEMs from config are accepted',()=>{
 const big=generateKeyPairSync('rsa',{modulusLength:3072});
 const pem=big.privateKey.export({format:'pem',type:'pkcs8'}).toString().replace(/\n/g,'\\n');
 const sig=Buffer.from(signRs256(pem,'x'));
 assert.equal(sig.length,384);
 assert.equal(createVerify('RSA-SHA256').update('x').verify(big.publicKey,sig),true);
});

test('signer rejects unusable keys without echoing key material',()=>{
 const small=generateKeyPairSync('rsa',{modulusLength:1024}).privateKey
  .export({format:'pem',type:'pkcs1'}).toString();
 const ec=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey
  .export({format:'pem',type:'pkcs8'}).toString();
 const encrypted=RSA.privateKey.export({format:'pem',type:'pkcs8',
  cipher:'aes-256-cbc',passphrase:'test-only'}).toString();
 const lines=PKCS1.trim().split('\n');
 const tampered=[lines[0],...lines.slice(1,-1).map((l,i)=>i===8?l.replace(/[A-Za-z]/,c=>c==='A'?'B':'A'):l),lines.at(-1)].join('\n');
 for(const [pem,code] of [[small,/rsa-key-size/],[ec,/rsa-key-unsupported/],
   [encrypted,/rsa-key-encrypted/],['not a key',/rsa-key-invalid/],
   [tampered,/rsa-key-(invalid|inconsistent)/],[undefined,/rsa-key-invalid/]]){
  assert.throws(()=>signRs256(pem,'x'),error=>{
   assert.match(error.message,code);
   assert.equal(error.message.includes('MII'),false);
   return true;
  });
 }
});

test('canary readiness reports not-configured while 0041 is held and credentials are absent',async t=>{
 const db=await database(t,BASE);
 const none=await prCommentCanaryReadiness({db,readConfig:configFrom({})});
 assert.deepEqual({...none,missing:[...none.missing]},{configured:false,status:'not-configured',
  missing:['github-app-credentials','owner-authority-public-jwk','migration-0041']});
 const creds=await prCommentCanaryReadiness({db,readConfig:configFrom(FULL)});
 assert.deepEqual([...creds.missing],['migration-0041']);
 assert.equal(JSON.stringify(creds).includes('PRIVATE KEY'),false);
 const throwing=await prCommentCanaryReadiness({db,readConfig:async()=>{throw Error('down');}});
 assert.equal(throwing.configured,false);
 const noDb=await prCommentCanaryReadiness({readConfig:configFrom(FULL)});
 assert.deepEqual([...noDb.missing],['migration-0041']);
});

test('canary readiness is configured only with exact App ids, a usable key, the owner JWK and 0041',async t=>{
 const db=await database(t,[...BASE,...HELD]);
 assert.equal((await prCommentCanaryReadiness({db,readConfig:configFrom(FULL)})).configured,true);
 const wrongApp=await prCommentCanaryReadiness({db,readConfig:configFrom({...FULL,
  [PR_COMMENT_CANARY_CONFIG.appId]:'1'})});
 assert.deepEqual([...wrongApp.missing],['github-app-credentials-mismatch']);
 const badKey=await prCommentCanaryReadiness({db,readConfig:configFrom({...FULL,
  [PR_COMMENT_CANARY_CONFIG.privateKey]:'-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'})});
 assert.deepEqual([...badKey.missing],['github-app-private-key-unusable']);
});

test('the App JWT the canary sends verifies against the App public key',async t=>{
 const db=await database(t,[...BASE,...HELD]);
 const prepared=await preparePrCommentCanary({db,pullRequest:398});
 let authorization;
 const fetchImpl=async(url,options={})=>{
  assert.match(url,/\/app\/installations\/179066535\/access_tokens$/);
  authorization=options.headers.Authorization;
  return {status:403,ok:false,json:async()=>({})};
 };
 await assert.rejects(submitPrCommentCanary({db,prepared:{pullRequest:prepared.pullRequest,
  idempotencyKey:prepared.idempotencyKey,commentBody:prepared.commentBody,
  bodySha256:prepared.bodySha256},operationDigest:'f'.repeat(64),
  appCredentials:{appId:'5633654',installationId:'179066535',privateKey:PKCS8},
  fetchImpl,clock:()=>1_800_000_000_000}),/token-exchange-denied/);
 const jwt=authorization.replace(/^Bearer /,'');
 const [h,p,s]=jwt.split('.');
 assert.deepEqual(JSON.parse(Buffer.from(h,'base64url')),{alg:'RS256',typ:'JWT'});
 assert.deepEqual(JSON.parse(Buffer.from(p,'base64url')),
  {iat:1_799_999_970,exp:1_800_000_540,iss:'5633654'});
 assert.equal(createVerify('RSA-SHA256').update(h+'.'+p)
  .verify(RSA.publicKey,Buffer.from(s,'base64url')),true);
 const executions=(await db.query('SELECT count(*)::int AS n FROM github_idempotent_executions')).rows[0].n;
 assert.equal(executions,0,'a denied token exchange writes nothing');
});

test('canary sources no longer need node:crypto signing and gate every mode on readiness',async()=>{
 const read=path=>readFile(new URL('../cloud/hatchable/'+path,import.meta.url),'utf8');
 const lib=await read('lib/github-pr-comment-canary.js');
 const api=await read('api/brain/github-pr-comment-canary.js');
 const signer=await read('lib/rsa-pkcs1-sign.js');
 // The Hatchable isolate's node:crypto exposes createHash/createVerify but not
 // createSign; an unresolved named import fails the whole deploy.
 const code=src=>src.replace(/\/\/.*$/gm,'');
 for(const src of [lib,api,signer]){
  for(const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:crypto'/g))
   assert.deepEqual(m[1].split(',').map(x=>x.trim()).filter(Boolean),['createHash']);
  assert.doesNotMatch(code(src),/\bcreateSign\b|\brandomBytes\(|subtle\.(sign|importKey)/);
 }
 const gate=api.indexOf('if(!readiness.configured)return notConfigured(res,readiness);');
 assert.ok(gate>0);
 for(const mode of ["mode==='prepare'","mode==='reconcile'","mode!=='submit'"])
  assert.ok(api.indexOf(mode)>gate,mode+' must come after the readiness gate');
 assert.ok(api.indexOf("mode==='status'")<gate);
 assert.match(api,/status:'not-configured',\n  error:'canary-not-configured',missing:readiness.missing/);
});
