import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createSign,generateKeyPairSync} from 'node:crypto';
import {prepareReleasePasskey,submitReleasePasskey} from '../cloud/hatchable/lib/release-passkey.js';
import {deploymentReceiptResource,DEPLOYMENT_RECEIPT_POLICY_SHA} from '../cloud/hatchable/lib/deployment-release-receipt/read.js';
const request={key:'deploy-v999-main',target:'hatchable-v999',sourceSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),manifestFileCount:280,independentReadback:true};
const credentialId=Buffer.from('test-owner-passkey-credential').toString('base64url');
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const current={owner:'michaeljwilliams0123',preset:'release',profile_version:13,stop_version:7,max_paid_cents:0,allowed_operations:['cloud.deploy'],paused:false};
const manifest=async()=>({verified:true,target:request.target,sourceSha:request.sourceSha,artifactDigest:request.artifactDigest,manifestFileCount:280});
const fetchGithub=async()=>({ok:true,status:200,json:async()=>({object:{sha:request.sourceSha}})});
const config={get:async()=>''};
function fixture(){
 let row,recorded=0,used=false,counter=0;
 const db={query:async(sql,p)=>{
  if(sql.includes('INSERT INTO brain_owner_passkey_challenges')){
   row={grantId:p[0],challenge:p[1],credentialId:p[2],objectiveId:p[3],resource:p[4],policySha:p[5],profileVersion:p[6],stopVersion:p[7],actor:'mcp:ultron',operation:'cloud.deploy',administrativeChange:false,expiresAt:new Date(Date.now()+240000).toISOString(),publicKeySpki:pair.publicKey.export({format:'der',type:'spki'}).toString('base64url'),signCount:0};
   return {rows:[{expiresAt:row.expiresAt}]};
  }
  if(sql.includes('JOIN brain_owner_passkeys k'))return {rows:row?[{...row,usedAt:used?new Date().toISOString():null,signCount:counter}]:[]};
  if(sql.includes('INSERT INTO brain_deployment_release_receipts')){
   if(used)return {rows:[]};
   used=true;recorded++;counter=p[8];
   return {rows:[{receiptId:'1',grantId:row.grantId}]};
  }
  if(sql.includes('FROM brain_owner_autonomy_profile'))return {rows:[current]};
  throw Error('unexpected query');
 }};
 return {db,config,fetchGithub,verifyManifest:manifest,recorded:()=>recorded,row:()=>row};
}
function assertion(ch,{origin='https://ultron-mw-cloud.hatchable.site',flags=5,challenge=ch.challenge}={}){
 const count=Buffer.alloc(4);count.writeUInt32BE(1);
 const auth=Buffer.concat([createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest(),Buffer.from([flags]),count]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false}));
 const signature=createSign('sha256').update(Buffer.concat([auth,createHash('sha256').update(client).digest()])).sign(pair.privateKey);
 return {grantId:ch.grantId,credentialId,authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:signature.toString('base64url')};
}
test('real ES256 assertion binds one exact release and rejects replay',async()=>{
 const s=fixture(),ch=await prepareReleasePasskey({...s,request,credentialId});
 assert.equal(ch.ok,true);
 assert.equal(s.row().resource,deploymentReceiptResource(request));assert.equal(s.row().policySha,DEPLOYMENT_RECEIPT_POLICY_SHA);
 const proof=assertion(ch);
 assert.equal((await submitReleasePasskey({...s,request,proof})).status,'observed');
 assert.equal((await submitReleasePasskey({...s,request,proof})).ok,false);
 assert.equal(s.recorded(),1);
});
test('wrong origin, missing UV, mismatched release, tampered challenge, or drift cannot record',async()=>{
 const s=fixture(),ch=await prepareReleasePasskey({...s,request,credentialId});
 for(const args of [
  {request,proof:assertion(ch,{origin:'https://other.invalid'})},
  {request,proof:assertion(ch,{flags:1})},
  {request,proof:assertion(ch,{challenge:Buffer.alloc(32,9).toString('base64url')})},
  {request:{...request,target:'hatchable-v998'},proof:assertion(ch)},
  {request,proof:assertion(ch),verifyManifest:async()=>({verified:false})},
  {request,proof:assertion(ch),fetchGithub:async()=>({ok:true,status:200,json:async()=>({object:{sha:'c'.repeat(40)}})})}
 ])assert.equal((await submitReleasePasskey({...s,...args})).ok,false);
 assert.equal(s.recorded(),0);
});
test('no challenge for unverified manifest or noncanonical main',async()=>{
 const s=fixture();
 assert.equal((await prepareReleasePasskey({...s,request,credentialId,verifyManifest:async()=>({verified:false})})).ok,false);
 assert.equal(s.row(),undefined);
});
