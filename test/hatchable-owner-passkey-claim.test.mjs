import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../cloud/hatchable/',import.meta.url);
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const load=p=>readFile(new URL(p,root),'utf8');
const provider=data((await load('lib/mcp-provider-write.js'))
 .replace("'lib/security-adjudicator.js'",JSON.stringify(new URL('lib/security-adjudicator.js',root).href)));
const authority=data((await load('lib/owner-passkey-authorization.js'))
 .replace("'lib/webauthn-owner.js'",JSON.stringify(new URL('lib/webauthn-owner.js',root).href))
 .replace("'lib/mcp-provider-write.js'",JSON.stringify(provider)));
const {authorizeOwnerPasskeyProvider}=await import(authority);
const txt=s=>new TextEncoder().encode(s);
const b64=x=>Buffer.from(x).toString('base64url');
function derInt(v){
 let i=0;while(i<v.length-1&&v[i]===0)i++;
 let body=v.slice(i);if(body[0]&0x80)body=Uint8Array.from([0,...body]);
 return Uint8Array.from([2,body.length,...body]);
}
function der(raw){
 const a=derInt(raw.slice(0,32)),b=derInt(raw.slice(32));
 return Uint8Array.from([0x30,a.length+b.length,...a,...b]);
}
async function setup(){
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE brain_owner_autonomy_profile(id SMALLINT PRIMARY KEY,owner TEXT,preset TEXT,
   version BIGINT,max_paid_cents INTEGER,allowed_operations JSONB,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO brain_owner_autonomy_profile VALUES(1,'michaeljwilliams0123','release',7,0,
   '["gitlab.branch.create","owner.passkey.enroll"]');
  CREATE TABLE brain_runtime_control(id SMALLINT PRIMARY KEY,paused BOOLEAN,version BIGINT);
  INSERT INTO brain_runtime_control VALUES(1,false,5);
  CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT NOT NULL,details JSONB NOT NULL);
  CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,
    actor TEXT NOT NULL,operation TEXT NOT NULL,resource TEXT NOT NULL,
    policy_sha TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
  INSERT INTO brain_authority_grants VALUES('bootstrap-id-123','bootstrap','mcp:ultron',
   'owner.passkey.enroll','sha256:'||repeat('d',64),repeat('e',64),now()+interval '1 hour');
  CREATE TABLE brain_mcp_provider_writes(action_key TEXT PRIMARY KEY,operation TEXT NOT NULL,
   fingerprint TEXT NOT NULL,resource_key TEXT NOT NULL,grant_id TEXT NOT NULL,
   profile_version BIGINT NOT NULL,stop_version BIGINT NOT NULL,status TEXT NOT NULL,
   evidence JSONB,updated_at TIMESTAMPTZ DEFAULT now());
 `);
 await db.exec(await load('migrations/0033_owner_passkey_authority.sql'));
 await db.exec(await load('migrations/0034_owner_passkey_enrollment.sql'));
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const spki=b64(new Uint8Array(await webcrypto.subtle.exportKey('spki',pair.publicKey)));
 const credentialId=b64(webcrypto.getRandomValues(new Uint8Array(32)));
 const grantId='passkey-'+webcrypto.randomUUID();
 const challenge=b64(webcrypto.getRandomValues(new Uint8Array(32)));
 const binding={key:'passkeytest001',operation:'gitlab.branch.create',
  fingerprint:'a'.repeat(64),resourceKey:'c'.repeat(64),policySha:'b'.repeat(64),
  expectedProfileVersion:7,expectedStopVersion:5};
 await db.query(`INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,sign_count,
  enrollment_key,enrollment_fingerprint,enrolled_grant_id)
  VALUES($1,$2,'owner key',0,'first-enroll-key',repeat('d',64),'bootstrap-id-123')`,
  [credentialId,spki]);
 await db.query(`INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,actor,
  objective_id,operation,resource,policy_sha,administrative_change,profile_version,
  stop_version,expires_at)
  VALUES($1,$2,$3,'mcp:ultron',$4,'gitlab.branch.create',$5,$6,false,7,5,
   now()+interval '5 minutes')`,
  [grantId,challenge,credentialId,binding.key,'sha256:'+binding.fingerprint,binding.policySha]);
 const rpHash=new Uint8Array(await webcrypto.subtle.digest('SHA-256',txt('ultron-mw-cloud.hatchable.site')));
 const auth=Uint8Array.from([...rpHash,0x05,0,0,0,1]);
 const client=txt(JSON.stringify({type:'webauthn.get',origin:'https://ultron-mw-cloud.hatchable.site',
  challenge,crossOrigin:false}));
 const clientHash=new Uint8Array(await webcrypto.subtle.digest('SHA-256',client));
 const signature=der(new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
  pair.privateKey,Uint8Array.from([...auth,...clientHash]))));
 const proof={grantId,credentialId,authenticatorData:b64(auth),
  clientDataJSON:b64(client),signature:b64(signature)};
 return {db,binding,proof};
}
test('valid owner passkey atomically consumes challenge, claims provider once and preserves stop fence',async()=>{
 const h=await setup();
 try{
  const authorized=await authorizeOwnerPasskeyProvider({db:h.db,binding:h.binding,proof:h.proof});
  assert.equal(authorized.grantId,h.proof.grantId);
  assert.equal(await authorized.claim(),true);
  assert.equal(await authorized.canDispatch(),true);
  assert.equal(await authorized.claim(),false);
  const r=await h.db.query(`SELECT count(*)::int AS count FROM brain_mcp_provider_writes`);
  assert.equal(r.rows[0].count,1);
  const used=await h.db.query(`SELECT used_at IS NOT NULL AS used FROM brain_owner_passkey_challenges`);
  assert.equal(used.rows[0].used,true);
  const replay=await authorizeOwnerPasskeyProvider({db:h.db,binding:h.binding,proof:h.proof});
  assert.equal(replay.error?.status,'held');
 }finally{await h.db.close();}
});
test('wrong binding, pause and stale credentials never claim',async()=>{
 const h=await setup();
 try{
  const wrong=await authorizeOwnerPasskeyProvider({db:h.db,
   binding:{...h.binding,fingerprint:'f'.repeat(64)},proof:h.proof});
  assert.equal(wrong.error?.status,'held');
  const valid=await authorizeOwnerPasskeyProvider({db:h.db,binding:h.binding,proof:h.proof});
  await h.db.query(`UPDATE brain_runtime_control SET paused=true WHERE id=1`);
  assert.equal(await valid.claim(),false);
  const rows=await h.db.query(`SELECT count(*)::int AS count FROM brain_mcp_provider_writes`);
  assert.equal(rows.rows[0].count,0);
 }finally{await h.db.close();}
});
