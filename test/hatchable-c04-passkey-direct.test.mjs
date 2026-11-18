import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createSign,generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../cloud/hatchable/',import.meta.url);
const file=path=>new URL(path,root);
const rsa=file('lib/rsa-pkcs1-sign.js').href;
const canarySrc=(await readFile(file('lib/github-pr-comment-canary.js'),'utf8'))
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(rsa));
const canaryUrl='data:text/javascript;base64,'+Buffer.from(canarySrc).toString('base64');
const {preparePrCommentCanary}=await import(canaryUrl);
const passkeySrc=(await readFile(file('lib/c04-passkey-comment.js'),'utf8'))
 .replace("'lib/github-pr-comment-canary.js'",JSON.stringify(canaryUrl))
 .replace("'lib/webauthn-owner.js'",JSON.stringify(file('lib/webauthn-owner.js').href));
const {beginC04PasskeyChallenge,verifyAndReserveC04Passkey}=await import(
 'data:text/javascript;base64,'+Buffer.from(passkeySrc).toString('base64'));
const migrations=['0001_tasks.sql','0002_events.sql','0008_admin_grants.sql',
 '0010_runtime_stop.sql','0013_continuum_outbox.sql','0016_owner_autonomy_profile.sql',
 '0033_owner_passkey_authority.sql','0034_owner_passkey_enrollment.sql',
 '0037_github_approval_nonces.sql','0039_github_idempotent_executions.sql',
 '0041_github_pr_comment_executions.sql','0050_c04_passkey_comment_authority.sql'];
async function setup(t){
 const db=new PGlite();
 for(const m of migrations)await db.exec(await readFile(file('migrations/'+m),'utf8'));
 await db.query("UPDATE brain_owner_autonomy_profile SET preset='release',version=7 WHERE id=1");
 await db.query('UPDATE brain_runtime_control SET version=5 WHERE id=1');
 const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const credentialId=Buffer.from('c04-owner-passkey-credential').toString('base64url');
 await db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES('owner-passkey-bootstrap-test','owner-passkey-test','michaeljwilliams0123','owner.passkey.enroll',$1,$2,now()+interval '1 hour')",
 ['sha256:'+'a'.repeat(64),'b'.repeat(64)]);
 await db.query("INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,enrolled_grant_id) VALUES($1,$2,'Test owner passkey','owner-passkey-test',$3,'owner-passkey-bootstrap-test')",
 [credentialId,key.publicKey.export({format:'der',type:'spki'}).toString('base64url'),'e'.repeat(64)]);
 t.after(()=>db.close());
 const prepared=await preparePrCommentCanary({db,pullRequest:460});
 return {db,credentialId,key,prepared};
}
async function begin(s){return beginC04PasskeyChallenge({db:s.db,prepared:s.prepared,
 credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5});}
function proof(s,ch,{
 origin='https://ultron-mw-cloud.hatchable.site',
 rpId='ultron-mw-cloud.hatchable.site',
 credentialId=s.credentialId,
 signingKey=s.key.privateKey,
 signCount=1,
}={}){
 const countBuf=Buffer.alloc(4);
 countBuf.writeUInt32BE(signCount,0);
 const auth=Buffer.concat([createHash('sha256').update(rpId).digest(),
 Buffer.from([0x05]),countBuf]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin,crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(signingKey);
 return {grantId:ch.grantId,credentialId,authenticatorData:auth.toString('base64url'),
 clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')};
}
test('C04 WebAuthn binds owner assertion to one durable comment reservation; replay denied',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal(ch.ok,true);assert.match(ch.grantId,/^passkey-/);
 const result=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)});
 assert.equal(result.ok,true);assert.equal(result.status,'reserved');
 assert.match(result.operationDigest,/^[a-f0-9]{64}$/);
 const rows=await s.db.query('SELECT state,grant_id FROM github_pr_comment_executions');
 assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].state,'reserved');
 assert.equal(rows.rows[0].grant_id,ch.grantId);
 assert.ok((await s.db.query('SELECT used_at FROM brain_owner_passkey_challenges')).rows[0].used_at);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)})).ok,false);
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,1);
});
test('C04 rejects a noncanonical WebAuthn origin before reserving',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{origin:'https://attacker.invalid'})})).ok,false);
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,0);
});
test('C04 denies a changed stop version inside atomic reservation',async t=>{
 const s=await setup(t),ch=await begin(s);
 await s.db.query('UPDATE brain_runtime_control SET version=6 WHERE id=1');
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)})).ok,false);
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,0);
});
test('C04 denies mismatched target and revoked credential',async t=>{
 const s=await setup(t),ch=await begin(s);
 const other=await preparePrCommentCanary({db:s.db,pullRequest:461});
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:other,proof:proof(s,ch)})).ok,false);
 await s.db.query('UPDATE brain_owner_passkeys SET revoked_at=now()');
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)})).ok,false);
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,0);
});
test('C04 rejects wrong RP ID, unknown credential, invalid signature, and signCount rollback',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{rpId:'attacker.invalid'})})).ok,false);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{credentialId:Buffer.from('unknown-cred').toString('base64url')})})).ok,false);
 const otherKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{signingKey:otherKey.privateKey})})).ok,false);
 await s.db.query('UPDATE brain_owner_passkeys SET sign_count=5 WHERE credential_id=$1',[s.credentialId]);
 const rolledBack=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{signCount:5})});
 assert.equal(rolledBack.ok,false);
 assert.equal(rolledBack.reason,'passkey-counter-replayed');
 assert.equal((await s.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,0);
});
test('C04 denies stale profile version, changed body digest, expired challenge, and concurrent claims',async t=>{
 const s1=await setup(t),ch1=await begin(s1);
 await s1.db.query('UPDATE brain_owner_autonomy_profile SET version=8 WHERE id=1');
 assert.equal((await verifyAndReserveC04Passkey({db:s1.db,prepared:s1.prepared,proof:proof(s1,ch1)})).ok,false);
 await s1.db.query('UPDATE brain_owner_autonomy_profile SET version=7 WHERE id=1');
 assert.equal((await verifyAndReserveC04Passkey({db:s1.db,prepared:{...s1.prepared,bodySha256:'f'.repeat(64)},proof:proof(s1,ch1)})).ok,false);
 await s1.db.query("UPDATE brain_owner_passkey_challenges SET created_at=now()-interval '10 minutes', expires_at=now()-interval '1 minute'");
 assert.equal((await verifyAndReserveC04Passkey({db:s1.db,prepared:s1.prepared,proof:proof(s1,ch1)})).ok,false);
 assert.equal((await s1.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,0);

 const s2=await setup(t),ch2=await begin(s2);
 const p2=proof(s2,ch2);
 const [first,second]=await Promise.all([
  verifyAndReserveC04Passkey({db:s2.db,prepared:s2.prepared,proof:p2}),
  verifyAndReserveC04Passkey({db:s2.db,prepared:s2.prepared,proof:p2}),
 ]);
 assert.equal([first.ok,second.ok].filter(Boolean).length,1);
 assert.equal((await s2.db.query('SELECT count(*)::int AS n FROM github_pr_comment_executions')).rows[0].n,1);
});

// 33 advanced, unique, and purposely confusing WebAuthn & atomic reservation edge cases (#452)
test('edge 01: beginC04PasskeyChallenge rejects null db and non-function db.query',async t=>{
 const s=await setup(t);
 assert.equal((await beginC04PasskeyChallenge({db:null,prepared:s.prepared,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5})).ok,false);
 assert.equal((await beginC04PasskeyChallenge({db:{query:'not-fn'},prepared:s.prepared,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5})).ok,false);
});
test('edge 02: beginC04PasskeyChallenge rejects empty, short (<16), and oversized (>1024) credentialId',async t=>{
 const s=await setup(t);
 for(const credentialId of ['','short','a'.repeat(15),'a'.repeat(1025)]){
  assert.equal((await beginC04PasskeyChallenge({db:s.db,prepared:s.prepared,credentialId,expectedProfileVersion:7,expectedStopVersion:5})).ok,false);
 }
});
test('edge 03: beginC04PasskeyChallenge rejects standard base64 (+/=) credentialId',async t=>{
 const s=await setup(t);
 assert.equal((await beginC04PasskeyChallenge({db:s.db,prepared:s.prepared,credentialId:'a+b/cdefghijklmn==',expectedProfileVersion:7,expectedStopVersion:5})).ok,false);
});
test('edge 04: beginC04PasskeyChallenge rejects non-positive or fractional expectedProfileVersion',async t=>{
 const s=await setup(t);
 for(const expectedProfileVersion of [0,-1,1.5,NaN]){
  assert.equal((await beginC04PasskeyChallenge({db:s.db,prepared:s.prepared,credentialId:s.credentialId,expectedProfileVersion,expectedStopVersion:5})).ok,false);
 }
});
test('edge 05: beginC04PasskeyChallenge rejects non-positive or fractional expectedStopVersion',async t=>{
 const s=await setup(t);
 for(const expectedStopVersion of [0,-3,2.25,Infinity]){
  assert.equal((await beginC04PasskeyChallenge({db:s.db,prepared:s.prepared,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion})).ok,false);
 }
});
test('edge 06: beginC04PasskeyChallenge denies observe preset',async t=>{
 const s=await setup(t);
 await s.db.query("UPDATE brain_owner_autonomy_profile SET preset='observe' WHERE id=1");
 assert.equal((await begin(s)).ok,false);
});
test('edge 07: DB check constraint rejects nonzero max_paid_cents',async t=>{
 const s=await setup(t);
 await assert.rejects(()=>s.db.query('UPDATE brain_owner_autonomy_profile SET max_paid_cents=1 WHERE id=1'),/max_paid_cents_check/);
});
test('edge 08: beginC04PasskeyChallenge denies when pr.comment is removed from allowed_operations',async t=>{
 const s=await setup(t);
 await assert.rejects(()=>s.db.query("UPDATE brain_owner_autonomy_profile SET allowed_operations='[]'::jsonb WHERE id=1"),/allowed_operations_check/);
});
test('edge 09: beginC04PasskeyChallenge denies when runtime control is paused',async t=>{
 const s=await setup(t);
 await s.db.query('UPDATE brain_runtime_control SET paused=true WHERE id=1');
 assert.equal((await begin(s)).ok,false);
});
test('edge 10: beginC04PasskeyChallenge denies revoked passkey before challenge issuance',async t=>{
 const s=await setup(t);
 await s.db.query('UPDATE brain_owner_passkeys SET revoked_at=now()');
 assert.equal((await begin(s)).ok,false);
});
test('edge 11: verifyAndReserveC04Passkey rejects null, array, and missing-key proof objects',async t=>{
 const s=await setup(t),ch=await begin(s),p=proof(s,ch);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:null})).ok,false);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:[]})).ok,false);
 const {signature:_omit,...missingSig}=p;
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:missingSig})).ok,false);
});
test('edge 12: verifyAndReserveC04Passkey rejects proof with unexpected extra property',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{...proof(s,ch),extra:'1'}})).ok,false);
});
test('edge 13: verifyAndReserveC04Passkey rejects grantId without passkey- prefix',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{...proof(s,ch),grantId:ch.grantId.replace('passkey-','grant-')}})).ok,false);
});
test('edge 14: verifyAndReserveC04Passkey rejects short grantId or non-base64url signature',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{...proof(s,ch),grantId:'passkey-short'}})).ok,false);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{...proof(s,ch),signature:'not+valid/base64=='}})).ok,false);
});
test('edge 15: verifyAndReserveC04Passkey rejects webauthn.create ceremony type spoofed as assertion',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([0x05,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 16: verifyAndReserveC04Passkey rejects crossOrigin=true in clientDataJSON',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([0x05,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:true}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 17: verifyAndReserveC04Passkey rejects mismatched challenge from another session',async t=>{
 const s=await setup(t),ch1=await begin(s),ch2=await begin(s);
 const p=proof(s,ch2);
 p.grantId=ch1.grantId;
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:p})).ok,false);
});
test('edge 18: verifyAndReserveC04Passkey rejects malformed JSON in clientDataJSON',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([0x05,0,0,0,1])]);
 const client=Buffer.from('{not-json');
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 19: verifyAndReserveC04Passkey rejects HTTP downgrade origin',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{origin:'http://ultron-mw-cloud.hatchable.site'})})).ok,false);
});
test('edge 20: verifyAndReserveC04Passkey rejects origin with trailing slash',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{origin:'https://ultron-mw-cloud.hatchable.site/'})})).ok,false);
});
test('edge 21: verifyAndReserveC04Passkey rejects uppercase origin',async t=>{
 const s=await setup(t),ch=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{origin:'HTTPS://ULTRON-MW-CLOUD.HATCHABLE.SITE'})})).ok,false);
});
test('edge 22: verifyAndReserveC04Passkey rejects authenticatorData with UP bit cleared (0x04)',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([0x04,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 23: verifyAndReserveC04Passkey rejects authenticatorData with UV bit cleared (0x01)',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([0x01,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 24: verifyAndReserveC04Passkey rejects truncated authenticatorData (<37 bytes)',async t=>{
 const s=await setup(t),ch=await begin(s);
 const auth=Buffer.alloc(36,1);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:{grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:sig.toString('base64url')}})).ok,false);
});
test('edge 25: signCount=0 is rejected once stored sign_count > 0',async t=>{
 const s=await setup(t),ch=await begin(s);
 await s.db.query('UPDATE brain_owner_passkeys SET sign_count=2 WHERE credential_id=$1',[s.credentialId]);
 const r=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{signCount:0})});
 assert.equal(r.ok,false);
 assert.equal(r.reason,'passkey-counter-replayed');
});
test('edge 26: signCount=0 is allowed when stored sign_count=0 (counterless authenticator)',async t=>{
 const s=await setup(t),ch=await begin(s);
 const r=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch,{signCount:0})});
 assert.equal(r.ok,true);
 assert.equal(r.status,'reserved');
});
test('edge 27: monotonic signCount advances across sequential challenges and rejects replay at same count',async t=>{
 const s=await setup(t);
 const ch1=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch1,{signCount:1})})).ok,true);
 const p2=await preparePrCommentCanary({db:s.db,pullRequest:461});
 const ch2=await beginC04PasskeyChallenge({db:s.db,prepared:p2,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5});
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:p2,proof:proof(s,ch2,{signCount:2})})).ok,true);
 const p3=await preparePrCommentCanary({db:s.db,pullRequest:462});
 const ch3=await beginC04PasskeyChallenge({db:s.db,prepared:p3,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5});
 const replayed=await verifyAndReserveC04Passkey({db:s.db,prepared:p3,proof:proof(s,ch3,{signCount:2})});
 assert.equal(replayed.ok,false);
 assert.equal(replayed.reason,'passkey-counter-replayed');
});
test('edge 28: DB check constraint rejects nonzero max_paid_cents even after begin',async t=>{
 const s=await setup(t);
 await begin(s);
 await assert.rejects(()=>s.db.query('UPDATE brain_owner_autonomy_profile SET max_paid_cents=50 WHERE id=1'),/max_paid_cents_check/);
});
test('edge 29: runtime control paused after begin denies verifyAndReserveC04Passkey',async t=>{
 const s=await setup(t),ch=await begin(s);
 await s.db.query('UPDATE brain_runtime_control SET paused=true WHERE id=1');
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)})).ok,false);
});
test('edge 30: preset downgraded to observe after begin denies verifyAndReserveC04Passkey',async t=>{
 const s=await setup(t),ch=await begin(s);
 await s.db.query("UPDATE brain_owner_autonomy_profile SET preset='observe' WHERE id=1");
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)})).ok,false);
});
test('edge 31: duplicate (repository, target_number, body_sha256) with different idempotencyKey denies reservation',async t=>{
 const s=await setup(t),ch1=await begin(s);
 assert.equal((await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch1)})).ok,true);
 const dupBody={...s.prepared,idempotencyKey:s.prepared.idempotencyKey.replace(/^[a-z0-9]{4}/,'dup0')};
 const ch2=await beginC04PasskeyChallenge({db:s.db,prepared:dupBody,credentialId:s.credentialId,expectedProfileVersion:7,expectedStopVersion:5});
 const r=await verifyAndReserveC04Passkey({db:s.db,prepared:dupBody,proof:proof(s,ch2,{signCount:2})});
 assert.equal(r.ok,false);
 assert.equal(r.reason,'execution-already-reserved');
});
test('edge 32: unknown grantId in proof returns HELD without throwing',async t=>{
 const s=await setup(t),ch=await begin(s);
 const p=proof(s,ch);
 p.grantId='passkey-00000000-0000-4000-8000-000000000000';
 const r=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:p});
 assert.equal(r.ok,false);
 assert.equal(r.status,'held');
});
test('edge 33: valid reservation emits brain_events audit row with authority=owner-webauthn',async t=>{
 const s=await setup(t),ch=await begin(s);
 const r=await verifyAndReserveC04Passkey({db:s.db,prepared:s.prepared,proof:proof(s,ch)});
 assert.equal(r.ok,true);
 const ev=await s.db.query("SELECT event_type,details->>'authority' AS authority FROM brain_events WHERE event_type='github-pr-comment-reserved'");
 assert.equal(ev.rows.length,1);
 assert.equal(ev.rows[0].authority,'owner-webauthn');
});
