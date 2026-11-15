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
function proof(s,ch,{origin='https://ultron-mw-cloud.hatchable.site'}={}){
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),
 Buffer.from([0x05,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin,crossOrigin:false}));
 const sig=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(s.key.privateKey);
 return {grantId:ch.grantId,credentialId:s.credentialId,authenticatorData:auth.toString('base64url'),
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
