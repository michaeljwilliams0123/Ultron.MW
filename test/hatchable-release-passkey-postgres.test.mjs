import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createSign,generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareReleasePasskey,submitReleasePasskey} from '../cloud/hatchable/lib/release-passkey.js';
import {readDeploymentReleaseReceipt} from '../cloud/hatchable/lib/deployment-release-receipt/read.js';

const request={key:'deploy-v999-main',target:'hatchable-v999',sourceSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),manifestFileCount:280,independentReadback:true};
const credentialId=Buffer.from('test-release-owner-passkey').toString('base64url');
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const file=n=>new URL('../cloud/hatchable/migrations/'+n,import.meta.url);
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,actor TEXT NOT NULL,operation TEXT NOT NULL,resource TEXT NOT NULL,policy_sha TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE brain_owner_autonomy_profile(id INTEGER PRIMARY KEY,owner TEXT,preset TEXT,allowed_operations JSONB,version INTEGER,updated_at TIMESTAMPTZ DEFAULT now(),max_paid_cents INTEGER);
 CREATE TABLE brain_runtime_control(id INTEGER PRIMARY KEY,paused BOOLEAN,version INTEGER);
 CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT,details JSONB);
 INSERT INTO brain_owner_autonomy_profile VALUES(1,'michaeljwilliams0123','release','["repo.inspect"]',12,now(),0);
 INSERT INTO brain_runtime_control VALUES(1,false,7);`);
 for(const m of ['0033_owner_passkey_authority.sql','0050_c04_passkey_comment_authority.sql','0051_deployment_release_receipts.sql','0053_release_passkey_receipt.sql'])await db.exec(await readFile(file(m),'utf8'));
 await db.exec(await readFile(file('0053_release_passkey_receipt.sql'),'utf8'));
 await db.query("INSERT INTO brain_authority_grants VALUES('bootstrap-test-grant','owner-passkey-test','mcp:ultron','owner.passkey.enroll',$1,$2,now()+interval '1 hour')",['sha256:'+'c'.repeat(64),'d'.repeat(64)]);
 await db.query("INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,enrolled_grant_id) VALUES($1,$2,'Test owner','owner-passkey-test',$3,'bootstrap-test-grant')",[credentialId,pair.publicKey.export({format:'der',type:'spki'}).toString('base64url'),'e'.repeat(64)]);
 return {db,config:{get:async()=>''},fetchGithub:async()=>({ok:true,status:200,json:async()=>({object:{sha:request.sourceSha}})}),verifyManifest:async()=>({verified:true,target:request.target,sourceSha:request.sourceSha,artifactDigest:request.artifactDigest,manifestFileCount:280})};
}
function assertion(ch){
 const count=Buffer.alloc(4);count.writeUInt32BE(1);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([5]),count]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch.challenge,origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const signature=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(pair.privateKey);
 return {grantId:ch.grantId,credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:signature.toString('base64url')};
}
const count=async db=>Number((await db.query('SELECT count(*) AS n FROM brain_deployment_release_receipts')).rows[0].n);
test('database atomically records one passkey-bound receipt and reconciles concurrent replay',async t=>{
 const s=await setup(t),ch=await prepareReleasePasskey({...s,request,credentialId});
 assert.equal(ch.ok,true);
 const args={...s,request,proof:assertion(ch)};
 const results=await Promise.all([submitReleasePasskey(args),submitReleasePasskey(args)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(await count(s.db),1);
 const receipt=await readDeploymentReleaseReceipt({db:s.db,request,grantId:ch.grantId});
 assert.equal(receipt.status,'observed');assert.equal(receipt.grantId,ch.grantId);
 assert.equal(Number((await s.db.query("SELECT count(*) n FROM brain_events WHERE event_type='deployment-release-receipt-recorded'")).rows[0].n),1);
});
test('database claim rejects changed profile, stopped runtime, revoked credential, expired challenge and stale counter',async t=>{
 const s=await setup(t),ch=await prepareReleasePasskey({...s,request,credentialId});
 assert.equal(ch.ok,true);const args={...s,request,proof:assertion(ch)};
 await s.db.exec('UPDATE brain_owner_autonomy_profile SET version=14');
 assert.equal((await submitReleasePasskey(args)).ok,false);
 await s.db.exec('UPDATE brain_owner_autonomy_profile SET version=13; UPDATE brain_runtime_control SET paused=true');
 assert.equal((await submitReleasePasskey(args)).ok,false);
 await s.db.exec('UPDATE brain_runtime_control SET paused=false; UPDATE brain_owner_passkeys SET revoked_at=now()');
 assert.equal((await submitReleasePasskey(args)).ok,false);
 await s.db.exec('UPDATE brain_owner_passkeys SET revoked_at=NULL,sign_count=1');
 assert.equal((await submitReleasePasskey(args)).ok,false);
 await s.db.exec("UPDATE brain_owner_passkeys SET sign_count=0; UPDATE brain_owner_passkey_challenges SET created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute'");
 assert.equal((await submitReleasePasskey(args)).ok,false);
 assert.equal(await count(s.db),0);
});
