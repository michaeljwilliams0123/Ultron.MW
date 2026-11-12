import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../cloud/hatchable/',import.meta.url);
const source=async p=>readFile(new URL(p,root),'utf8');
const url=p=>new URL(p,root).href;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const enroller=await import(data((await source('lib/owner-passkey-enrollment.js'))
 .replace("'lib/security-adjudicator.js'",JSON.stringify(url('lib/security-adjudicator.js')))
 .replace("'lib/webauthn-owner.js'",JSON.stringify(url('lib/webauthn-owner.js')))));
const txt=x=>new TextEncoder().encode(x),b64=x=>Buffer.from(x).toString('base64url');
const cat=(...parts)=>Uint8Array.from(parts.flatMap(p=>[...p]));
function cborHeader(k,n){return n<24?Uint8Array.of(k<<5|n):
 n<256?Uint8Array.of(k<<5|24,n):Uint8Array.of(k<<5|25,n>>8,n&255);}
function cbor(v){
 if(v instanceof Uint8Array)return cat(cborHeader(2,v.length),v);
 if(typeof v==='number')return cborHeader(v<0?1:0,v<0?-v-1:v);
 if(typeof v==='string'){const b=txt(v);return cat(cborHeader(3,b.length),b);}
 if(v instanceof Map)return cat(cborHeader(5,v.size),
  ...[...v].flatMap(([k,z])=>[cbor(k),cbor(z)]));
 throw Error('invalid CBOR fixture');
}
async function fixture(challenge){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 const credentialId=webcrypto.getRandomValues(new Uint8Array(32));
 const rpHash=new Uint8Array(await webcrypto.subtle.digest('SHA-256',txt('ultron-mw-cloud.hatchable.site')));
 const cose=cbor(new Map([[1,2],[3,-7],[-1,1],
  [-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],
  [-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const auth=cat(rpHash,Uint8Array.of(0x45,0,0,0,0),new Uint8Array(16),
  Uint8Array.of(0,32),credentialId,cose);
 return {credentialId:b64(credentialId),
  clientDataJSON:b64(txt(JSON.stringify({type:'webauthn.create',challenge,
   origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}))),
  attestationObject:b64(cbor(new Map([['fmt','none'],['attStmt',new Map()],
   ['authData',auth]])))};
}
async function setup(){
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE brain_owner_autonomy_profile(id SMALLINT PRIMARY KEY,owner TEXT,preset TEXT,
   version BIGINT,max_paid_cents INTEGER,allowed_operations JSONB,
   updated_at TIMESTAMPTZ DEFAULT now());
  INSERT INTO brain_owner_autonomy_profile VALUES(1,'michaeljwilliams0123','release',
   6,0,'["gitlab.branch.create"]',now());
  CREATE TABLE brain_runtime_control(id SMALLINT PRIMARY KEY,paused BOOLEAN,version BIGINT);
  INSERT INTO brain_runtime_control VALUES(1,false,5);
  CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT,details JSONB);
  CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,
    actor TEXT NOT NULL,operation TEXT NOT NULL,resource TEXT NOT NULL,
    policy_sha TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 `);
 await db.exec(await source('migrations/0033_owner_passkey_authority.sql'));
 await db.exec(await source('migrations/0034_owner_passkey_enrollment.sql'));
 const issuer=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},
  true,['sign','verify']);
 const publicJwk=JSON.stringify(await webcrypto.subtle.exportKey('jwk',issuer.publicKey));
 const config={async get(n){if(n==='ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK')return publicJwk;}};
 return {db,config,issuer};
}
async function signedGrant(privateKey,g){
 const now=Date.now();
 const payload=JSON.stringify({schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  authorizedBy:'michaeljwilliams0123',audience:'ultron-cloud-brain',
  grantId:'owner-'+webcrypto.randomUUID(),policySha:g.policySha,
  notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+120000).toISOString(),
  ...g});
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
  privateKey,txt(payload));
 return {payload,signature:b64(signature)};
}
test('owner-signed bootstrap registers verified credential once and preserves receipt',async()=>{
 const h=await setup();
 try{
  const request={key:'owner-passkey-001',label:'My owner passkey',
   expectedProfileVersion:7,expectedStopVersion:5};
  const prepare=await enroller.prepareOwnerPasskey({db:h.db,request});
  assert.equal(prepare.ok,true,JSON.stringify(prepare));
  const envelope=await signedGrant(h.issuer.privateKey,prepare.grantRequest);
  const attestation=await fixture(prepare.challenge);
  const finish=await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope,attestation});
  assert.equal(finish.status,'enrolled',JSON.stringify(finish));
  assert.equal((await enroller.listOwnerPasskeys({db:h.db})).length,1);
  const second=await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope,attestation});
  assert.equal(second.status,'held');
  const grant=await h.db.query('SELECT count(*)::int AS n FROM brain_authority_grants');
  assert.equal(grant.rows[0].n,1);
 }finally{await h.db.close();}
});
test('unsigned, mismatched and revoked owner enrollment fail closed',async()=>{
 const h=await setup();
 try{
  const request={key:'owner-passkey-002',label:'Owner credential',
   expectedProfileVersion:7,expectedStopVersion:5};
  const prepared=await enroller.prepareOwnerPasskey({db:h.db,request});
  const attestation=await fixture(prepared.challenge);
  const bad=await signedGrant(h.issuer.privateKey,{...prepared.grantRequest,
   objectiveId:'wrong-objective'});
  assert.equal((await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope:bad,attestation})).status,'held');
  await h.db.query('UPDATE brain_runtime_control SET paused=true WHERE id=1');
  const good=await signedGrant(h.issuer.privateKey,prepared.grantRequest);
  const blocked=await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope:good,attestation});
  assert.notEqual(blocked.status,'enrolled');
 }finally{await h.db.close();}
});

test('enrollment provides safe grant-versus-attestation failure categories',async()=>{
 const h=await setup();
 try{
  const request={key:'owner-passkey-diagnostic-1',label:'Owner device',
   expectedProfileVersion:7,expectedStopVersion:5};
  const prepared=await enroller.prepareOwnerPasskey({db:h.db,request});
  assert.equal(prepared.status,'prepared');
  const attestation=await fixture(prepared.challenge);
  const wrong=await signedGrant(h.issuer.privateKey,{...prepared.grantRequest,objectiveId:'wrong'});
  const rejectedGrant=await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope:wrong,attestation});
  assert.equal(rejectedGrant.reason,'enrollment-owner-grant-verification-failed');
  const good=await signedGrant(h.issuer.privateKey,prepared.grantRequest);
  const rejectedAttestation=await enroller.finishOwnerPasskey({db:h.db,config:h.config,
   key:request.key,envelope:good,
   attestation:{...attestation,attestationObject:'invalid-encoding'}});
  assert.match(rejectedAttestation.reason,/^enrollment-webauthn-(encoding-invalid|attestation-invalid)$/);
  assert.equal((await enroller.listOwnerPasskeys({db:h.db})).length,0);
 }finally{await h.db.close();}
});
