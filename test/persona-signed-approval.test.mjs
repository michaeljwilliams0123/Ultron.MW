import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {enforceSignedApprovalAndTagPersona}
 from '../src/middleware/enforce-signed-approval.mjs';
import {requiredTokenPermissions,ULTRON_REPOSITORY_ID}
 from '../src/github-principal-policy.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
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
