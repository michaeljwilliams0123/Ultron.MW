/** Source-only shadow execution evidence. No network, provider token or release grant.
 * Not a replacement for Trusted Council, owner WebAuthn or existing outbox.
 * A production adapter MUST pin the owner key and perform independent readback.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {canonicalJson} from './git-hubs.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const NONCE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{11,95}$/;
const SHA40=/^[a-f0-9]{40}$/;
const grantFields=['v','eventId','nonce','payloadSha256','repository','sourceSha',
 'grantId','actor','operation','expiresAt'];
const sha256=x=>createHash('sha256').update(x).digest('hex');
const denial=message=>{throw Error('omni-'+message)};

export function authorizationMessage(grant){
 if(!grant||typeof grant!=='object'||Array.isArray(grant))denial('authorization-denied');
 const data={};
 for(const name of grantFields){
  if(grant[name]===undefined)denial('authorization-denied');
  data[name]=grant[name];
 }
 return 'ULTRON-OMNI-SHADOW-AUTH-v1\n'+canonicalJson(data)+'\n';
}

function validateAdmission({payload,nonce,repository=REPO,sourceSha,
 effect='advisory',maxPaidCents=0}={}){
 if(!payload||Array.isArray(payload)||typeof payload!=='object'||
  typeof nonce!=='string'||!NONCE.test(nonce)||
  repository!==REPO||typeof sourceSha!=='string'||!SHA40.test(sourceSha)||
  !['read','advisory'].includes(effect)||maxPaidCents!==0)
  denial('admission-denied');
 let json;
 try{json=canonicalJson(payload)}catch{denial('admission-denied')}
 if(json.length>64_000)denial('admission-denied');
 return {json,nonce,repository,sourceSha,effect,maxPaidCents,payloadSha256:sha256(json)};
}
function shape(row){
 if(!row)return null;
 return {id:row.id,nonce:row.nonce,payload:row.payload,payloadSha256:row.payload_sha256,
  repository:row.repository,sourceSha:row.source_sha,effect:row.effect,
  maxPaidCents:row.max_paid_cents,currentState:row.current_state,
  grantId:row.grant_id,ownerProofSha:row.owner_proof_sha,
  providerReceipt:row.provider_receipt,providerReceiptSha:row.provider_receipt_sha};
}
function requireTrustedGrant(grant,event,ownerPublicJwk){
 if(!ownerPublicJwk||ownerPublicJwk.kty!=='EC'||ownerPublicJwk.crv!=='P-256'||
  typeof ownerPublicJwk.x!=='string'||typeof ownerPublicJwk.y!=='string')
  denial('authorization-denied');
 if(grant?.v!==1||grant.eventId!==event.id||grant.nonce!==event.nonce||
  grant.payloadSha256!==event.payloadSha256||grant.repository!==REPO||
  grant.sourceSha!==event.sourceSha||grant.actor!=='mcp:ultron'||
  grant.operation!=='omni.shadow.authorize'||
  typeof grant.grantId!=='string'||grant.grantId.length<12||
  typeof grant.signature!=='string'||!/^[A-Za-z0-9_-]{40,}$/.test(grant.signature))
  denial('authorization-denied');
 const expires=Date.parse(grant.expiresAt);
 const now=Date.now();
 if(!Number.isFinite(expires)||expires<=now||expires>now+5*60*1000)
  denial('authorization-denied');
 try{
  const body=authorizationMessage(grant);
  const pub=createPublicKey({key:ownerPublicJwk,format:'jwk'});
  const ok=verify('sha256',Buffer.from(body,'utf8'),pub,Buffer.from(grant.signature,'base64url'));
  if(!ok)denial('authorization-denied');
  return sha256(body+grant.signature);
 }catch{denial('authorization-denied')}
}
function requireDb(db){
 if(typeof db?.query!=='function')denial('database-required');
}

export function createOmniShadowMachine({db,ownerPublicJwk=null}={}){
 requireDb(db);
 // Pin the verifier's public key at construction; never re-read mutable config.
 const pinnedOwnerJwk=ownerPublicJwk&&typeof ownerPublicJwk==='object'?Object.freeze({
  kty:ownerPublicJwk.kty,crv:ownerPublicJwk.crv,
  x:ownerPublicJwk.x,y:ownerPublicJwk.y}):null;
 async function getEvent(id){
  if(typeof id!=='string'||id.length<32)denial('event-id-invalid');
  const result=await db.query('SELECT * FROM brain_omni_shadow_events WHERE id=$1',[id]);
  if(!Array.isArray(result?.rows)||result.rows.length!==1)denial('event-not-found');
  return shape(result.rows[0]);
 }
 async function transition(id,expected,next,extra={},reason=''){
  const entries={current_state:next,...extra};
  const columns=Object.keys(entries),params=[id,expected];
  const set=columns.map((name,i)=>{
   params.push(entries[name]);
   return name+'=$'+(i+3);
  }).join(',');
  const result=await db.query('UPDATE brain_omni_shadow_events SET '+set+
   ' WHERE id=$1 AND current_state=$2 RETURNING id',params);
  if(result?.rows?.length!==1)denial('invalid-transition');
  let actual;
  try{actual=await getEvent(id)}catch{denial('reconcile-required')}
  if(actual.currentState!==next)denial('reconcile-required');
  return actual;
 }
 async function ingestEvent(input){
  const c=validateAdmission(input);
  // Persist the exact admission snapshot; never re-read mutable getters/proxies.
  const json=c.json;
  const args=[c.nonce,json,c.payloadSha256,c.repository,c.sourceSha,c.effect,c.maxPaidCents];
  try{
   await db.query("INSERT INTO brain_omni_shadow_events(nonce,payload,payload_sha256,repository,source_sha,effect,max_paid_cents) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7) ON CONFLICT(nonce) DO NOTHING",args);
  }catch{denial('admission-reconcile-required')}
  let result;
  try{result=await db.query('SELECT * FROM brain_omni_shadow_events WHERE nonce=$1',[c.nonce])}
  catch{denial('admission-reconcile-required')}
  if(result?.rows?.length!==1)denial('admission-reconcile-required');
  const existing=shape(result.rows[0]);
  if(existing.payloadSha256!==c.payloadSha256||existing.sourceSha!==c.sourceSha||
    existing.repository!==c.repository||existing.effect!==c.effect||
    existing.maxPaidCents!==c.maxPaidCents||
    canonicalJson(existing.payload)!==json)
   denial('nonce-conflict');
  return existing;
 }
 async function persistEvent(id){
  const current=await getEvent(id);
  if(current.currentState!=='RECEIVED')denial('invalid-transition');
  return transition(id,'RECEIVED','PERSISTED');
 }
 async function authorizeEvent(id,{grant}={}){
  const event=await getEvent(id);
  if(event.currentState!=='PERSISTED')denial('invalid-transition');
  // Freeze the exact signed fields once before crypto verification and SQL.
  let captured;
  try{captured=Object.fromEntries([...grantFields,'signature'].map(k=>[k,grant?.[k]]));}
  catch{denial('authorization-denied')}
  const proof=requireTrustedGrant(captured,event,pinnedOwnerJwk);
  try{
   return await transition(id,'PERSISTED','AUTHORIZED',{
    grant_id:captured.grantId,owner_proof_sha:proof});
  }catch(e){
   if(/omni-/.test(String(e)))throw e;
   denial('authorization-denied');
  }
 }
 async function markReconcileRequired(id,reason='unknown external result'){
  const event=await getEvent(id);
  if(event.currentState!=='AUTHORIZED')denial('invalid-transition');
  if(typeof reason!=='string'||!reason||reason.length>200)denial('reason-invalid');
  return transition(id,'AUTHORIZED','RECONCILE_REQUIRED',{reason});
 }
 async function completeExecution(id,{receipt,verifyReadback}={}){
  const event=await getEvent(id);
  if(!['AUTHORIZED','RECONCILE_REQUIRED'].includes(event.currentState))
   denial('invalid-transition');
  if(typeof verifyReadback!=='function')denial('readback-required');
  // Canonical snapshot BEFORE independent provider readback: no TOCTOU getters.
  let json,captured;
  try{json=canonicalJson(receipt);captured=JSON.parse(json)}
  catch{denial('readback-rejected')}
  if(json.length>16_000||!captured||typeof captured!=='object'||
    Array.isArray(captured)||captured.nonce!==event.nonce||
    captured.payloadSha256!==event.payloadSha256||
    typeof captured.provider!=='string'||!captured.provider||
    typeof captured.effectId!=='string'||!captured.effectId)
   denial('readback-rejected');
  let ok;
  try{ok=await verifyReadback({event,receipt:captured})}
  catch{denial('readback-rejected')}
  if(ok!==true)denial('readback-rejected');
  return transition(id,event.currentState,'EXECUTED_AND_VERIFIED',{
   provider_receipt:json,provider_receipt_sha:sha256(json),reason:null});
 }
 return Object.freeze({ingestEvent,persistEvent,authorizeEvent,markReconcileRequired,completeExecution,getEvent});
}
