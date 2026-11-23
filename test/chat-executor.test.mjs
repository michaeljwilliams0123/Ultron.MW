import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,createSign} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {
 validateMergeRequest,beginPasskeyMergeChallenge,verifyAndReservePasskeyMerge,
 executeSquashMerge,reconcileSquashMerge
} from '../cloud/hatchable/lib/chat-executor.js';

const HEAD='a'.repeat(40), MERGE_SHA='b'.repeat(40);
const b64=buf=>buf.toString('base64url');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

async function setupDb(){
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE brain_owner_autonomy_profile(
   id INTEGER PRIMARY KEY,owner TEXT,preset TEXT,allowed_operations JSONB,
   version INTEGER,max_paid_cents INTEGER,updated_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE brain_runtime_control(id INTEGER PRIMARY KEY,paused BOOLEAN,version INTEGER);
  CREATE TABLE brain_owner_passkeys(
   credential_id TEXT PRIMARY KEY,public_key_spki TEXT NOT NULL,
   sign_count BIGINT NOT NULL DEFAULT 0,revoked_at TIMESTAMPTZ,last_used_at TIMESTAMPTZ);
  CREATE TABLE brain_owner_passkey_challenges(
   grant_id TEXT PRIMARY KEY,challenge TEXT NOT NULL UNIQUE,credential_id TEXT NOT NULL,
   actor TEXT NOT NULL,objective_id TEXT NOT NULL,operation TEXT NOT NULL,
   resource TEXT NOT NULL,policy_sha TEXT NOT NULL,administrative_change BOOLEAN NOT NULL,
   profile_version INTEGER NOT NULL,stop_version INTEGER NOT NULL,
   expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   used_at TIMESTAMPTZ);
  CREATE TABLE brain_github_approval_nonces(
   nonce TEXT PRIMARY KEY,operation TEXT NOT NULL,target_resource TEXT NOT NULL,
   approval_timestamp TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
  CREATE TABLE brain_authority_grants(
   grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,actor TEXT NOT NULL,
   operation TEXT NOT NULL,resource TEXT NOT NULL,policy_sha TEXT NOT NULL,
   expires_at TIMESTAMPTZ NOT NULL);
  CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT,details JSONB);
  CREATE TABLE council_room_messages(
   id BIGSERIAL PRIMARY KEY,room_key TEXT NOT NULL,message_key TEXT NOT NULL UNIQUE,
   author_type TEXT NOT NULL,author_id TEXT NOT NULL,kind TEXT NOT NULL,
   body TEXT NOT NULL,context JSONB NOT NULL DEFAULT '{}'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO brain_owner_autonomy_profile VALUES
   (1,'michaeljwilliams0123','release','["pr.comment"]',7,0,now());
  INSERT INTO brain_runtime_control VALUES(1,false,5);
 `);
 await db.exec(read('cloud/hatchable/migrations/0052_conversational_pr_merge_executor.sql'));
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const spki=b64(key.publicKey.export({type:'spki',format:'der'}));
 const credentialId=b64(Buffer.from('cred-chat-merge-0123456789'));
 await db.query('INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,sign_count) VALUES($1,$2,0)',
  [credentialId,spki]);
 return {db,key,credentialId};
}
function signAssertion(key,credentialId,challenge,grantId,signCount=1){
 const rpHash=createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest();
 const flags=Buffer.from([0x05]);
 const cnt=Buffer.alloc(4);cnt.writeUInt32BE(signCount);
 const auth=Buffer.concat([rpHash,flags,cnt]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,
  origin:'https://ultron-mw-cloud.hatchable.site',crossOrigin:false}));
 const msg=Buffer.concat([auth,createHash('sha256').update(client).digest()]);
 const sig=createSign('sha256').update(msg).sign(key.privateKey);
 return {grantId,credentialId,authenticatorData:b64(auth),
  clientDataJSON:b64(client),signature:b64(sig)};
}

test('0052 migration enables pr.merge and conversational executor completes with in-chat receipt',async t=>{
 const {db,key,credentialId}=await setupDb();t.after(()=>db.close());
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 const appCredentials={appId:'5633654',installationId:'179066535',
  privateKey:rsa.privateKey.export({type:'pkcs8',format:'pem'})};
 const prepared={pullRequest:518,headSha:HEAD,
  idempotencyKey:'ultron-chat-merge-pr518-'+'c'.repeat(24),room:'owner-main'};
 assert.ok(validateMergeRequest(prepared));
 const ch=await beginPasskeyMergeChallenge({db,prepared,credentialId,
  expectedProfileVersion:8,expectedStopVersion:5});
 assert.equal(ch.ok,true);
 const proof=signAssertion(key,credentialId,ch.challenge,ch.grantId,1);
 const reserved=await verifyAndReservePasskeyMerge({db,prepared,proof});
 assert.equal(reserved.ok,true);
 const replay=await verifyAndReservePasskeyMerge({db,prepared,proof});
 assert.equal(replay.ok,false);
 let calls=0;
 const fetchImpl=async(url,opts={})=>{
  calls++;
  if(String(url).includes('/access_tokens'))
   return new Response(JSON.stringify({token:'ghs_test'}),{status:201});
  if(String(url).endsWith('/pulls/518/merge')&&opts.method==='PUT')
   return new Response(JSON.stringify({merged:true,sha:MERGE_SHA}),{status:200});
  if(String(url).endsWith('/pulls/518')&&opts.method==='GET')
   return new Response(JSON.stringify({merged:true,merge_commit_sha:MERGE_SHA,head:{sha:HEAD}}),{status:200});
  throw Error('unexpected-url:'+url);
 };
 const out=await executeSquashMerge({db,prepared,operationDigest:reserved.operationDigest,
  grantId:reserved.grantId,appCredentials,fetchImpl});
 assert.equal(out.ok,true);assert.equal(out.status,'completed');
 assert.equal(out.receipt.details.mergeCommitSha,MERGE_SHA);
 assert.equal(calls,3);
 const msgs=(await db.query('SELECT author_id,kind,body,context FROM council_room_messages')).rows;
 assert.equal(msgs.length,1);assert.equal(msgs[0].kind,'receipt');
 assert.equal(msgs[0].context.mergeCommitSha,MERGE_SHA);
 assert.equal(msgs[0].context.remoteVerified,true);
});

test('uncertain merge enters reconcile_required and recovers without replay',async t=>{
 const {db,key,credentialId}=await setupDb();t.after(()=>db.close());
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 const appCredentials={appId:'5633654',installationId:'179066535',
  privateKey:rsa.privateKey.export({type:'pkcs8',format:'pem'})};
 const prepared={pullRequest:519,headSha:HEAD,
  idempotencyKey:'ultron-chat-merge-pr519-'+'d'.repeat(24),room:'owner-main'};
 const ch=await beginPasskeyMergeChallenge({db,prepared,credentialId,
  expectedProfileVersion:8,expectedStopVersion:5});
 const reserved=await verifyAndReservePasskeyMerge({db,prepared,
  proof:signAssertion(key,credentialId,ch.challenge,ch.grantId,1)});
 const failPut=async(url,opts={})=>{
  if(String(url).includes('/access_tokens'))
   return new Response(JSON.stringify({token:'ghs_test'}),{status:201});
  throw Error('network-timeout');
 };
 const uncertain=await executeSquashMerge({db,prepared,operationDigest:reserved.operationDigest,
  grantId:reserved.grantId,appCredentials,fetchImpl:failPut});
 assert.equal(uncertain.ok,false);assert.equal(uncertain.status,'reconcile-required');
 const recoverGet=async(url,opts={})=>{
  if(String(url).includes('/access_tokens'))
   return new Response(JSON.stringify({token:'ghs_test'}),{status:201});
  if(String(url).endsWith('/pulls/519')&&opts.method==='GET')
   return new Response(JSON.stringify({merged:true,merge_commit_sha:MERGE_SHA,head:{sha:HEAD}}),{status:200});
  throw Error('unexpected-write');
 };
 const recovered=await reconcileSquashMerge({db,prepared,operationDigest:reserved.operationDigest,
  grantId:reserved.grantId,appCredentials,fetchImpl:recoverGet});
 assert.equal(recovered.ok,true);assert.equal(recovered.receipt.status,'reconciled_success');
});

test('chat-execute route enforces owner, origin and ultron-chat wires passkey merge + driftDetails',()=>{
 const route=read('cloud/hatchable/api/brain/chat-execute.js');
 assert.match(route,/export const access='admin'/);
 assert.match(route,/michaeljwilliams0123/);
 assert.match(route,/https:\/\/ultron-mw-cloud\.hatchable\.site/);
 const ui=read('cloud/hatchable/public/ultron-chat.js');
 assert.match(ui,/\/api\/brain\/chat-execute/);
 assert.match(ui,/navigator\.credentials/);
 assert.match(ui,/driftDetails/);
 const proof=read('cloud/hatchable/api/brain/release-proof.js');
 assert.match(proof,/driftDetails/);
 assert.match(proof,/verifyLiveHatchableManifest/);
});

test('verifyLiveHatchableManifest verifies exact live artifact digest and rejects drift or missing token',async()=>{
 const {verifyLiveHatchableManifest}=await import('../cloud/hatchable/lib/hatchable-manifest-readback.js');
 const {deploymentArtifactDigest}=await import('../cloud/hatchable/lib/deployment-release-receipt/read.js');
 const files=[{path:'api/brain/run.js',hash:'1'.repeat(64)},{path:'public/ultron-chat.js',hash:'2'.repeat(64)}];
 const digest=deploymentArtifactDigest(files);
 const row={target:'hatchable-v138',source_sha:HEAD,artifact_digest:digest,manifest_file_count:2};
 const unconfigured=await verifyLiveHatchableManifest({deploymentRow:row,config:{get:async()=>''}});
 assert.equal(unconfigured.verified,false);assert.equal(unconfigured.reason,'hatchable-manifest-reader-unconfigured');
 const mcpSuccess=payload=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,
  result:{content:[{type:'text',text:JSON.stringify(payload)}]}}),{status:200});
 const configured={get:async k=>k==='ULTRON_HATCHABLE_API_TOKEN'?'test-token':''};
 const ok=await verifyLiveHatchableManifest({deploymentRow:row,config:configured,
  fetchImpl:async()=>mcpSuccess({version:138,status:'live',source_sha:HEAD,file_manifest:files})});
 assert.equal(ok.verified,true);assert.equal(ok.state,'live-manifest-verified');
 const drifted=await verifyLiveHatchableManifest({deploymentRow:row,config:configured,
  fetchImpl:async()=>mcpSuccess({version:138,status:'live',source_sha:HEAD,
   file_manifest:[{path:'api/brain/run.js',hash:'9'.repeat(64)}]})});
 assert.equal(drifted.verified,false);assert.equal(drifted.state,'manifest-drift-detected');
});
