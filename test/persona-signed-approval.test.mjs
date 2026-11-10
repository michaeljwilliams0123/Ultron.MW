import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {enforceSignedApprovalAndTagPersona}
 from '../src/middleware/enforce-signed-approval.mjs';
import {requiredTokenPermissions,ULTRON_REPOSITORY_ID}
 from '../src/github-principal-policy.mjs';

const REPO='Ultron-MW/Ultron.MW';
const NOW=Date.parse('2026-11-09T23:45:00Z');
const KEY='test-only-long-cryptographic-approval-secret-123456789';
const OP='repair.branch.create';
const NONCE='persona-approval-nonce-0001abcdefgh';
const scope=(operation=OP)=>({
 operation,repositoryId:ULTRON_REPOSITORY_ID,
 permissions:requiredTokenPermissions(operation)
});
const plan=(patch={})=>({
 schema:'ultron.github.operation.v1',repository:REPO,
 operation:OP,activeAgentRole:'Builder',
 idempotencyKey:'admin:persona-task2-0001',
 permittedScope:scope(),parameters:{branch:'ultron/persona-task2'},
 ...patch
});
const envelope=(payload,nonce=NONCE)=>({
 toolName:payload.operation,
 targetResource:'ultron:github:'+REPO+':sha256:'+
  createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
 timestamp:NOW,nonce
});
const request=(payload=plan(),nonce=NONCE)=>{
 const signedGrant=envelope(payload,nonce);
 return {signedGrant,nonce,signature:createHmac('sha256',KEY)
  .update(JSON.stringify(signedGrant)).digest('hex'),
  payload,activeAgentRole:payload.activeAgentRole};
};
const fakeDb=()=>{
 const seen=new Set();
 return {query:async(sql,args)=>{
  assert.match(sql,/INSERT INTO brain_github_approval_nonces/);
  assert.match(sql,/ON CONFLICT \(nonce\) DO NOTHING/);
  if(seen.has(args[0]))return {rows:[]};
  seen.add(args[0]);return {rows:[{nonce:args[0]}]};
 }};
};
const fakeFactory=(override={})=>({
 getTokenForScope:async(requested)=>({
  token:'test-only-scoped-token',...requested,installationId:42,
  expiresAt:new Date(NOW+1800000).toISOString(),...override
 })
});
const trusted=(overrides={})=>({
 db:fakeDb(),trustedKey:KEY,expectedInstallationId:42,
 clock:()=>NOW,...overrides
});

test('valid signed plan binds one trusted GitHub App and one Council persona',async()=>{
 const p=plan(),input=request(p);
 const result=await enforceSignedApprovalAndTagPersona(input,fakeFactory(),trusted());
 assert.equal(result.authorized,true);
 assert.equal(result.token,'test-only-scoped-token');
 assert.equal(result.persona.authorName,'Ultron.MW [Builder]');
 assert.equal(result.persona.authorEmail,'ultron-mw-builder@system.local');
 assert.equal(result.persona.commitMessagePrefix,'[autonomy:builder]');
 assert.equal(result.commitHeaders.author.name,result.persona.authorName);
 assert.equal(result.commitHeaders.author.email,result.persona.authorEmail);
 assert.equal(result.commitHeaders.trailers['Ultron-Role'],'Builder');
 assert.deepEqual(result.executionPayload,p);
 assert.equal(Object.isFrozen(result.executionPayload),true);
 assert.notEqual(result.executionPayload,p);
 assert.equal(JSON.stringify(result.persona).includes('test-only-scoped-token'),false);
});

test('atomic nonce claim accepts one racing request and rejects replay',async()=>{
 const db=fakeDb(),opts=trusted({db}),f=fakeFactory(),input=request();
 const outcomes=await Promise.allSettled([
  enforceSignedApprovalAndTagPersona(input,f,opts),
  enforceSignedApprovalAndTagPersona(input,f,opts)
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 await assert.rejects(
  enforceSignedApprovalAndTagPersona(input,f,opts),/invalid|replay|denied/i);
});

test('signature binds persona, operation, parameters and exact permission scope',async()=>{
 const original=request();
 for(const mutation of [
  {...original,activeAgentRole:'Steward'},
  {...original,payload:{...original.payload,activeAgentRole:'Steward'}},
  {...original,payload:{...original.payload,operation:'repository.settings.update'}},
  {...original,payload:{...original.payload,
    parameters:{branch:'ultron/attacker'}}},
  {...original,payload:{...original.payload,
    permittedScope:{...scope(),permissions:{metadata:'read',administration:'write'}}}},
  {...original,nonce:'persona-other-nonce-0002abcdefgh'},
  {...original,signedGrant:{...original.signedGrant,
    targetResource:'ultron:github:'+REPO+':sha256:'+'0'.repeat(64)}},
  {...original,signature:'approved'}
 ]){
  await assert.rejects(
   enforceSignedApprovalAndTagPersona(mutation,fakeFactory(),trusted()),
   /invalid|denied|scope|signature|role|approval/i);
 }
});

test('unknown persona and foreign repository reject before issuance',async()=>{
 for(const p of [
  plan({activeAgentRole:'Root'}),
  plan({repository:'another/repository'}),
  plan({permittedScope:{operation:OP,repositoryId:12,
   permissions:requiredTokenPermissions(OP)}}),
  plan({permittedScope:{...scope(),permissions:{contents:'write'}}})
 ]){
  let issued=false;
  await assert.rejects(
   enforceSignedApprovalAndTagPersona(request(p),{
    getTokenForScope:async()=>{issued=true;throw Error('must-not-mint');}
   },trusted()),/invalid|denied|scope|role|repository/i);
  assert.equal(issued,false);
 }
});

test('token factory must prove exact profile, installation and unexpired grant',async()=>{
 for(const bad of [
  {repositoryId:123},
  {permissions:{metadata:'read',administration:'write'}},
  {operation:'actions.cancel'},
  {installationId:123},
  {expiresAt:new Date(NOW-1000).toISOString()},
  {expiresAt:new Date(NOW+3600001).toISOString()},
  {token:''}
 ]){
  await assert.rejects(enforceSignedApprovalAndTagPersona(
   request(),fakeFactory(bad),trusted()),/token|scope|profile|invalid|denied/i);
 }
 await assert.rejects(enforceSignedApprovalAndTagPersona(
  request(),{getTokenForScope:async()=> 'raw-unverifiable-token'},
  trusted()),/token|scope|profile|invalid|denied/i);
});

test('unavailable nonce ledger fails closed; never issues token',async()=>{
 let issued=false;
 await assert.rejects(enforceSignedApprovalAndTagPersona(
  request(),{getTokenForScope:async()=>{issued=true;return null;}},
  trusted({db:{query:async()=>{throw Error('database unavailable');}}})),
  /invalid|replay|denied|database|approval/i);
 assert.equal(issued,false);
});

test('expired approval is refused and cannot consume a nonce',async()=>{
 const db={query:async()=>{throw Error('nonce must not be reached')}};
 await assert.rejects(enforceSignedApprovalAndTagPersona(
  request(),fakeFactory(),trusted({db,clock:()=>NOW+300001})),
  /invalid|expired|denied|approval/i);
});

test('P-256 signed grant uses trusted public key, not request metadata',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const r=request();
 r.signature=sign('sha256',Buffer.from(JSON.stringify(r.signedGrant)),
  {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const opts=trusted({algorithm:'ecdsa-p256-sha256',trustedKey:publicKey});
 const result=await enforceSignedApprovalAndTagPersona(r,fakeFactory(),opts);
 assert.equal(result.authorized,true);
});

test('migration 0037 has global primary-key nonce ledger (PGlite integration)',async(t)=>{
 let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
 if(!PGlite){if(process.env.CI==='true')throw Error('PGlite required in CI');t.skip('PGlite not installed');return;}
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL(
   '../cloud/hatchable/migrations/0037_github_approval_nonces.sql',import.meta.url),'utf8'));
  const r=request(plan(), 'persona-pglite-nonce-0003abcdefgh');
  // SQL uses the actual PostgreSQL clock, so use a signed timestamp near real time.
  const now=Date.now(),p=plan();
  const signedGrant={...envelope(p,r.nonce),timestamp:now};
  const input={signedGrant,nonce:r.nonce,payload:p,activeAgentRole:p.activeAgentRole,
   signature:createHmac('sha256',KEY).update(JSON.stringify(signedGrant)).digest('hex')};
  const opts=trusted({db,clock:()=>now});
  const token={getTokenForScope:async(s)=>({
   token:'pglite-test-token',...s,installationId:42,
   expiresAt:new Date(now+1800000).toISOString()
  })};
  const first=await enforceSignedApprovalAndTagPersona(input,token,opts);
  assert.equal(first.authorized,true);
  await assert.rejects(enforceSignedApprovalAndTagPersona(input,token,opts),
   /invalid|replay|denied/i);
  const receipt=await db.query('SELECT nonce FROM brain_github_approval_nonces WHERE nonce=$1',[r.nonce]);
  assert.equal(receipt.rows.length,1);
 }finally{await db.close();}
});

test('authorization response must not serialize an installation token',async()=>{
 const result=await enforceSignedApprovalAndTagPersona(request(),fakeFactory(),trusted());
 assert.equal(result.token,'test-only-scoped-token');
 assert.equal(Object.keys(result).includes('token'),false);
 assert.equal(JSON.stringify(result).includes('test-only-scoped-token'),false);
 assert.equal(JSON.stringify({...result}).includes('test-only-scoped-token'),false);
});

test('approval expiration after slow token issuance denies before executor handoff',async()=>{
 let current=NOW;
 const opts=trusted({clock:()=>current});
 const factory={getTokenForScope:async(s)=>{
  current=NOW+300_001;
  return {token:'test-only-scoped-token',...s,installationId:42,
   expiresAt:new Date(NOW+45*60_000).toISOString()};
 }};
 await assert.rejects(enforceSignedApprovalAndTagPersona(request(),factory,opts),
  /expired|invalid|denied/i);
});

test('expired token after asynchronous issuance denies executor handoff',async()=>{
 let current=NOW;
 const opts=trusted({clock:()=>current});
 const factory={getTokenForScope:async(s)=>{
  current=NOW+60_000;
  return {token:'test-only-scoped-token',...s,installationId:42,
   expiresAt:new Date(NOW+30_000).toISOString()};
 }};
 await assert.rejects(enforceSignedApprovalAndTagPersona(request(),factory,opts),
  /expired|invalid|denied/i);
});

test('token-provider exceptions do not disclose credential text',async()=>{
 const factory={getTokenForScope:async()=>{throw Error(
  'token exchange failure: SECRET-credential-never-to-expose');}};
 await assert.rejects(enforceSignedApprovalAndTagPersona(request(),factory,trusted()),
  error=>!/SECRET-credential-never-to-expose/.test(error.message) &&
   /unavailable|denied|token/i.test(error.message));
});

test('every Council role receives signed, accurate attribution with one App',async()=>{
 for(const role of ['Builder','Skeptic','Steward','Predictor',
   'Generator','Sentinel','Companion']){
  const p=plan({activeAgentRole:role});
  const result=await enforceSignedApprovalAndTagPersona(
   request(p),fakeFactory(),trusted());
  assert.equal(result.persona.role,role);
  assert.equal(result.commitHeaders.trailers['Ultron-Role'],role);
  assert.equal(result.commitHeaders.trailers['Ultron-App-Principal'],'ultron-github-app');
  assert.equal(result.persona.attributionOnly,true);
 }
});

test('debug inspection cannot disclose installation credential',async()=>{
 const {inspect}=await import('node:util');
 const result=await enforceSignedApprovalAndTagPersona(
  request(),fakeFactory(),trusted());
 assert.doesNotMatch(inspect(result,{showHidden:true,depth:6}),
  /test-only-scoped-token/);
 assert.equal(result.token,'test-only-scoped-token');
});

test('nonce stays consumed when token factory fails; no second issuance',async()=>{
 const db=fakeDb(),opts=trusted({db}),input=request();
 let count=0;
 const factory={getTokenForScope:async scope=>{
  count++;
  if(count===1)throw Error('temporary-token-provider-failure');
  return {token:'test-only-scoped-token',...scope,installationId:42,
   expiresAt:new Date(NOW+1800000).toISOString()};
 }};
 await assert.rejects(
  enforceSignedApprovalAndTagPersona(input,factory,opts),/unavailable/i);
 await assert.rejects(
  enforceSignedApprovalAndTagPersona(input,factory,opts),/invalid|replay/i);
 assert.equal(count,1,'nonce replay must reject BEFORE requesting another token');
});

test('mutable caller request cannot alter signed execution payload across await',async()=>{
 const req=request(),originalBranch=req.payload.parameters.branch;
 const factory={getTokenForScope:async scope=>{
  req.payload.parameters.branch='ultron/attacker';
  req.activeAgentRole='Companion';
  req.signedGrant.targetResource='ultron:github:attacker/repo:sha256:'+'f'.repeat(64);
  return {token:'test-only-scoped-token',...scope,installationId:42,
   expiresAt:new Date(NOW+1800000).toISOString()};
 }};
 const result=await enforceSignedApprovalAndTagPersona(req,factory,trusted());
 assert.equal(result.executionPayload.parameters.branch,originalBranch);
 assert.equal(result.persona.role,'Builder');
 assert.equal(Object.isFrozen(result.executionPayload.parameters),true);
});

test('reject alternative HMAC field ordering and untrusted metadata',async()=>{
 const r=request();
 const reversed={nonce:r.signedGrant.nonce,timestamp:r.signedGrant.timestamp,
  targetResource:r.signedGrant.targetResource,toolName:r.signedGrant.toolName};
 r.signature=createHmac('sha256',KEY).update(JSON.stringify(reversed)).digest('hex');
 await assert.rejects(enforceSignedApprovalAndTagPersona(r,fakeFactory(),trusted()),
  /invalid|denied|replay/i);
});

test('PGlite migration 0037 denies concurrent replay by a global unique nonce',async t=>{
 let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
 if(!PGlite){if(process.env.CI==='true')throw Error('PGlite required in CI');
  t.skip('PGlite not installed');return;}
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL(
   '../cloud/hatchable/migrations/0037_github_approval_nonces.sql',import.meta.url),'utf8'));
  const p=plan(),r=request(p,'persona-concurrent-db-0005abcdefgh');
  const now=Date.now();
  r.signedGrant.timestamp=now;
  r.signature=createHmac('sha256',KEY)
   .update(JSON.stringify(r.signedGrant)).digest('hex');
  const opts=trusted({db,clock:()=>now});
  let issued=0;
  const factory={getTokenForScope:async scope=>{
   issued++;return {token:'test-only-scoped-token',...scope,installationId:42,
    expiresAt:new Date(now+1800000).toISOString()};
  }};
  const outcomes=await Promise.allSettled(
   Array.from({length:24},()=>enforceSignedApprovalAndTagPersona(r,factory,opts)));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,23);
  assert.equal(issued,1);
  const readback=await db.query('SELECT COUNT(*)::int AS n FROM brain_github_approval_nonces');
  assert.equal(readback.rows[0].n,1);
 }finally{await db.close();}
});
