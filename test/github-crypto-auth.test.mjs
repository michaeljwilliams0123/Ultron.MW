import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
let PGlite;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('pglite-ci-dependency-unavailable');
const pgliteSkip=PGlite?false:'@electric-sql/pglite not installed';
import {
 verifyCryptographicApproval,createScopedInstallationTokenProvider,
 createSignedGitHubAuthority,createPostgresApprovalNonceStore,
} from '../src/security/crypto_auth.mjs';
import {requiredTokenPermissions,ULTRON_REPOSITORY_ID}
 from '../src/github-principal-policy.mjs';

const OP='actions.cancel';
const REPO='michaeljwilliams0123/Ultron.MW';
const KEY='a-very-long-trusted-server-only-hmac-secret-key-123456';
const NOW=Date.parse('2026-11-09T20:00:00Z');
const RESOURCE='ultron:github:'+REPO+':sha256:'+'a'.repeat(64);
const payload=(patch={})=>({toolName:OP,targetResource:RESOURCE,timestamp:NOW,
 nonce:'crypto-test-nonce-001abcdefghijkl',...patch});
const mac=p=>createHmac('sha256',KEY).update(JSON.stringify({
 toolName:p.toolName,targetResource:p.targetResource,timestamp:p.timestamp,nonce:p.nonce
})).digest('hex');
const replay=()=>{const used=new Set();return {consume:async(k)=>{if(used.has(k.nonce))return false;used.add(k.nonce);return true;}}};
const options=(extra={})=>({algorithm:'hmac-sha256',now:NOW,nonceStore:replay(),
 expectedToolName:OP,expectedTargetResource:RESOURCE,...extra});

test('HMAC approval is cryptographic, exact-scope, and one-use',async()=>{
 const p=payload(),s=mac(p),opts=options();
 assert.equal(await verifyCryptographicApproval(p,s,KEY,opts),true);
 assert.equal(await verifyCryptographicApproval(p,s,KEY,opts),false);
 for(const changed of [payload({toolName:'actions.rerun_failed'}),
  payload({targetResource:RESOURCE+'-other'}),payload({timestamp:NOW+300001}),
  payload({nonce:'crypto-other-nonce-001abcdefghijkl'}),
  payload({injected:'yes'})])
   assert.equal(await verifyCryptographicApproval(changed,s,KEY,options()),false);
 assert.equal(await verifyCryptographicApproval(p,'',KEY,options()),false);
 assert.equal(await verifyCryptographicApproval(p,'g'.repeat(64),KEY,options()),false);
 assert.equal(await verifyCryptographicApproval(p,s,'short',options()),false);
 assert.equal(await verifyCryptographicApproval(p,s,KEY,options({nonceStore:null})),false);
 assert.equal(await verifyCryptographicApproval(p,s,KEY,options({expectedToolName:'actions.cancel-other'})),false);
});

test('P-256 owner approval verifies signature bytes, refuses forgery',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const p=payload(),bytes=Buffer.from(JSON.stringify(p));
 const sig=sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const opts=options({algorithm:'ecdsa-p256-sha256'});
 assert.equal(await verifyCryptographicApproval(p,sig,publicKey,opts),true);
 assert.equal(await verifyCryptographicApproval(p,sig,publicKey,options({algorithm:'ecdsa-p256-sha256'})),true);
 assert.equal(await verifyCryptographicApproval(payload({toolName:'actions.verify.dispatch'}),sig,publicKey,
  options({algorithm:'ecdsa-p256-sha256'})),false);
});

test('signed authority adapter rejects unsigned _meta and binds plan digest',async()=>{
 const planDigest='a'.repeat(64);
 const p=payload(),envelope={payload:p,signature:mac(p)};
 const service=createSignedGitHubAuthority({
  getEnvelope:async()=>envelope,secretKey:KEY,nonceStore:replay(),
  expectedInstallationId:9123,clock:()=>NOW
 });
 const plan={operation:OP,idempotencyKey:'admin:unified-001'};
 const authorized=await service.verify(plan,planDigest);
 assert.equal(authorized.verified,true);
 assert.equal(authorized.planDigest,planDigest);
 assert.equal(authorized.installationId,9123);
 await assert.rejects(service.verify(plan,planDigest),/invalid|replay/i);
 const missing=createSignedGitHubAuthority({
  getEnvelope:async()=>({payload:p,signature:'approved'}),
  secretKey:KEY,nonceStore:replay(),expectedInstallationId:9123,clock:()=>NOW
 });
 await assert.rejects(missing.verify(plan,planDigest),/invalid/i);
});

test('future clock skew cannot extend signed authority beyond trusted verification time',async()=>{
 const planDigest='a'.repeat(64),plan={operation:OP,idempotencyKey:'admin:future-001'};
 const future=payload({timestamp:NOW+300_000});
 const service=createSignedGitHubAuthority({
  getEnvelope:async()=>({payload:future,signature:mac(future)}),
  secretKey:KEY,nonceStore:replay(),expectedInstallationId:9123,clock:()=>NOW
 });
 const authority=await service.verify(plan,planDigest);
 assert.equal(authority.expiresAt,new Date(NOW+300_000).toISOString());
 assert.ok(Date.parse(authority.expiresAt)-NOW<=300_000);

 const outsideSkew=payload({timestamp:NOW+300_001});
 const rejected=createSignedGitHubAuthority({
  getEnvelope:async()=>({payload:outsideSkew,signature:mac(outsideSkew)}),
  secretKey:KEY,nonceStore:replay(),expectedInstallationId:9123,clock:()=>NOW
 });
 await assert.rejects(rejected.verify(plan,planDigest),/invalid/i);
});

test('GitHub App issuer requests one repository and exact action permissions',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const seen=[];
 const getToken=createScopedInstallationTokenProvider({
  appId:12345,installationId:9123,privateKey,clock:()=>NOW,
  fetchImpl:async(url,init)=>{
   seen.push({url,init});
   return {ok:true,status:201,json:async()=>({
    token:'opaque-test-token',expires_at:'2026-11-09T20:45:00Z',
    permissions:requiredTokenPermissions(OP),
    repositories:[{id:ULTRON_REPOSITORY_ID,full_name:REPO}]
   })};
  }
 });
 const grant=await getToken({operation:OP,repositoryId:ULTRON_REPOSITORY_ID,
  permissions:requiredTokenPermissions(OP)});
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,'https://api.github.com/app/installations/9123/access_tokens');
 assert.deepEqual(JSON.parse(seen[0].init.body),{
  repository_ids:[ULTRON_REPOSITORY_ID],permissions:requiredTokenPermissions(OP)
 });
 assert.deepEqual(grant.permissions,{metadata:'read',actions:'write'});
 assert.equal(grant.token,'opaque-test-token');
 assert.equal(JSON.stringify({permissions:grant.permissions}).includes('opaque'),false);
 await assert.rejects(getToken({operation:OP,repositoryId:1,permissions:requiredTokenPermissions(OP)}),/scope/i);
 await assert.rejects(getToken({operation:OP,repositoryId:ULTRON_REPOSITORY_ID,
  permissions:{metadata:'read',administration:'write'}}),/scope/i);
 assert.equal(seen.length,1);
});

test('refuse overbroad GitHub token readback and never return it',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 for(const patch of [
  {permissions:{metadata:'read',actions:'write',administration:'write'}},
  {repositories:[{id:ULTRON_REPOSITORY_ID,full_name:REPO},{id:2,full_name:'other/repo'}]},
  {repositories:[{id:2,full_name:'other/repo'}]},
  {expires_at:'2026-11-09T21:30:00Z'},
  {expires_at:'2026-11-09T19:00:00Z'}
 ]){
  const getToken=createScopedInstallationTokenProvider({
   appId:12345,installationId:9123,privateKey,clock:()=>NOW,
   fetchImpl:async()=>({ok:true,status:201,json:async()=>({
    token:'opaque-test-token',permissions:requiredTokenPermissions(OP),
    repositories:[{id:ULTRON_REPOSITORY_ID,full_name:REPO}],
    expires_at:'2026-11-09T20:45:00Z',...patch
   })})
  });
  await assert.rejects(getToken({operation:OP,repositoryId:ULTRON_REPOSITORY_ID,
    permissions:requiredTokenPermissions(OP)}),/scope|profile/i);
 }
});

test('0037 migration and PostgreSQL nonce store admit once and reject replay',{skip:pgliteSkip},async()=>{
 const db=new PGlite();
 try{
  const migration=await readFile(new URL(
   '../cloud/hatchable/migrations/0037_github_approval_nonces.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const store=createPostgresApprovalNonceStore({db});
  const p=payload({timestamp:Date.now()});
  assert.equal(await store.consume(p),true);
  assert.equal(await store.consume(p),false);
  const stored=await db.query(`SELECT nonce,operation,target_resource,
    approval_timestamp,expires_at,consumed_at
    FROM brain_github_approval_nonces WHERE nonce=$1`,[p.nonce]);
  assert.equal(stored.rows.length,1);
  assert.equal(stored.rows[0].operation,p.toolName);
  assert.equal(stored.rows[0].target_resource,p.targetResource);
  assert.ok(Math.abs(Date.parse(stored.rows[0].expires_at)-p.timestamp-300_000)<1000);
  const expired=payload({timestamp:Date.now()-300_001,
   nonce:'crypto-expired-nonce-001abcdefghijkl'});
  assert.equal(await store.consume(expired),false);
 }finally{await db.close();}
});

test('PostgreSQL nonce store fails closed on unavailable database',async()=>{
 const requests=[];
 const store=createPostgresApprovalNonceStore({db:{query:async(sql,args)=>{
  requests.push({sql,args});
  return {rows:[{nonce:payload().nonce}]};
 }}});
 const p=payload();
 assert.equal(await store.consume(p),true);
 assert.match(requests[0].sql,/ON CONFLICT \(nonce\) DO NOTHING/);
 assert.match(requests[0].sql,/clock_timestamp\(\)/);
 const unavailable=createPostgresApprovalNonceStore({db:{query:async()=>{throw Error('down')}}});
 assert.equal(await unavailable.consume(p),false);
});

test('P-256 existing owner JWK public key is accepted without private-key exposure',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const p=payload(),sig=sign('sha256',Buffer.from(JSON.stringify(p)),
  {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const jwk=publicKey.export({format:'jwk'});
 assert.equal(await verifyCryptographicApproval(p,sig,jwk,
  options({algorithm:'ecdsa-p256-sha256'})),true);
});
