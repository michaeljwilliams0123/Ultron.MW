/**
 * Server-side GitHub operation approval and credential isolation.
 *
 * Untrusted MCP _meta may transport a signature and claims, NEVER a key,
 * installation identifier, expected scope, permission set or authority flag.
 * These must come from the trusted server configuration and validated plan.
 */
import {createHmac,createSign,createPublicKey,timingSafeEqual,verify as verifySignature}
 from 'node:crypto';
import {
 operationProfile,requiredTokenPermissions,ULTRON_REPOSITORY,
 ULTRON_REPOSITORY_ID,parseInstant,
} from '../github-principal-policy.mjs';

const TTL_MS=300_000;
const NONCE=/^[a-z0-9_-]{22,100}$/;
const HMAC=/^[a-f0-9]{64}$/;
const P256=/^[A-Za-z0-9_-]{86}$/;
const SHA256=/^[a-f0-9]{64}$/;
const RESOURCE_PREFIX='ultron:github:'+ULTRON_REPOSITORY+':sha256:';
const KEYS=['toolName','targetResource','timestamp','nonce'];
const exact=(obj,fields)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===fields.length&&
 Object.keys(obj).every(key=>fields.includes(key));

/** Approval claims MUST be signed in this fixed wire order (no JSON ambiguity). */
function canonical(payload){
 return JSON.stringify({toolName:payload.toolName,
  targetResource:payload.targetResource,timestamp:payload.timestamp,nonce:payload.nonce});
}

/**
 * Verify HMAC-SHA256 (lowercase 64-character hex) or P-256 ECDSA
 * (64-byte IEEE-P1363 signature encoded base64url).
 * nonceStore.consume MUST be a durable atomic insert-if-absent with a unique
 * nonce key; its claim TTL must be >= 5 minutes plus clock-skew tolerance.
 * Never fall back to an in-memory store for production.
 */
export async function verifyCryptographicApproval(payload,signature,trustedKey,{
 algorithm='hmac-sha256',now=Date.now(),nonceStore,
 expectedToolName,expectedTargetResource,
}={}){
 try{
  if(!exact(payload,KEYS)||
    typeof payload.toolName!=='string'||payload.toolName!==expectedToolName||
    typeof payload.targetResource!=='string'||payload.targetResource!==expectedTargetResource||
    !Number.isSafeInteger(payload.timestamp)||!Number.isSafeInteger(now)||
    Math.abs(now-payload.timestamp)>TTL_MS||!NONCE.test(payload.nonce)||
    !nonceStore||typeof nonceStore.consume!=='function'||
    typeof expectedToolName!=='string'||typeof expectedTargetResource!=='string')
   return false;
  const bytes=Buffer.from(canonical(payload),'utf8');
  let authenticated=false;
  if(algorithm==='hmac-sha256'){
   if(!HMAC.test(signature||''))return false;
   if(!(typeof trustedKey==='string'||Buffer.isBuffer(trustedKey))||
     Buffer.byteLength(trustedKey)<32)return false;
   const expected=createHmac('sha256',trustedKey).update(bytes).digest();
   const got=Buffer.from(signature,'hex');
   authenticated=got.length===expected.length&&timingSafeEqual(got,expected);
  }else if(algorithm==='ecdsa-p256-sha256'){
   if(!P256.test(signature||''))return false;
   const publicKey=trustedKey?.type==='public'?trustedKey:createPublicKey(trustedKey);
   if(publicKey.asymmetricKeyType!=='ec'||
      publicKey.asymmetricKeyDetails?.namedCurve!=='prime256v1')return false;
   const raw=Buffer.from(signature,'base64url');
   authenticated=raw.length===64&&
     verifySignature('sha256',bytes,{key:publicKey,dsaEncoding:'ieee-p1363'},raw);
  }else return false;
  if(!authenticated)return false;
  // The durable claim must be atomic; duplicate or unavailable store DENIES.
  return await nonceStore.consume({nonce:payload.nonce,
   toolName:payload.toolName,targetResource:payload.targetResource,
   timestamp:payload.timestamp})===true;
 }catch{return false;}
}

/**
 * Adapter for executeGitHubOperation(services.authority.verify).
 * getEnvelope obtains the untrusted envelope; the signing key, expected
 * installation ID, clock, nonce store and plan digest are trusted inputs.
 * The signed target binds the entire immutable SHA256 operation plan.
 */
export function createSignedGitHubAuthority({
 getEnvelope,secretKey,publicKey,algorithm='hmac-sha256',
 nonceStore,expectedInstallationId,clock=Date.now,
}={}){
 if(typeof getEnvelope!=='function'||typeof nonceStore?.consume!=='function'||
   typeof clock!=='function'||!Number.isSafeInteger(expectedInstallationId)||
   expectedInstallationId<1)throw Error('trusted GitHub approval configuration required');
 return Object.freeze({verify:async(plan,planDigest)=>{
  if(!SHA256.test(planDigest||'')||
     typeof plan?.operation!=='string'||typeof plan?.idempotencyKey!=='string')
   throw Error('invalid GitHub approval plan');
  const profile=operationProfile(plan.operation);
  const resource=RESOURCE_PREFIX+planDigest;
  const envelope=await getEnvelope({operation:plan.operation,planDigest});
  const payload=envelope?.payload;
  const accepted=await verifyCryptographicApproval(payload,envelope?.signature,
    algorithm==='hmac-sha256'?secretKey:publicKey,{
     algorithm,now:clock(),nonceStore,expectedToolName:plan.operation,
     expectedTargetResource:resource,
    });
  if(!accepted)throw Error('invalid or replayed cryptographic approval');
  // Only the trusted verifier can manufacture these trusted readback claims.
  return Object.freeze({
   source:profile.authorization==='step-up'
    ?'owner-step-up-authorization':'owner-standing-authorization',
   verified:true,actor:'michaeljwilliams0123',repository:ULTRON_REPOSITORY,
   operation:plan.operation,planDigest,idempotencyKey:plan.idempotencyKey,
   installationId:expectedInstallationId,grantId:'grant:'+payload.nonce,
   expiresAt:new Date(payload.timestamp+TTL_MS).toISOString(),
  });
 }});
}

function exactPermissions(actual,expected){
 return actual&&typeof actual==='object'&&!Array.isArray(actual)&&
  Object.keys(actual).length===Object.keys(expected).length&&
  Object.entries(expected).every(([key,value])=>actual[key]===value);
}

/**
 * Trusted server-only credential service for createUnifiedGitHubTransport.
 * A fresh JWT exchanges for a repository-ID and operation-specific token;
 * returned token is never serialized to untrusted metadata, logs or receipts.
 */
export function createScopedInstallationTokenProvider({
 appId,installationId,privateKey,fetchImpl=globalThis.fetch,clock=Date.now,
}={}){
 if(!Number.isSafeInteger(appId)||appId<1||
    !Number.isSafeInteger(installationId)||installationId<1||
    !privateKey||typeof fetchImpl!=='function'||typeof clock!=='function')
  throw Error('trusted GitHub App credentials required');
 return async function getToken(request){
  if(!exact(request,['operation','repositoryId','permissions'])||
     request.repositoryId!==ULTRON_REPOSITORY_ID)
   throw Error('GitHub installation token scope denied');
  let permissions;
  try{permissions=requiredTokenPermissions(request.operation);}
  catch{throw Error('GitHub installation token scope denied');}
  if(!exactPermissions(request.permissions,permissions))
   throw Error('GitHub installation token scope denied');
  const now=clock(),seconds=Math.floor(now/1000);
  if(!Number.isSafeInteger(now)||seconds<1)
   throw Error('GitHub installation token clock invalid');
  const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+
   b64({iat:seconds-30,exp:seconds+540,iss:String(appId)});
  let jwt;
  try{jwt=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end()
   .sign(privateKey).toString('base64url');}
  catch{throw Error('GitHub App signing configuration invalid');}
  let response;
  try{
   response=await fetchImpl(
    'https://api.github.com/app/installations/'+installationId+'/access_tokens',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
     headers:{Authorization:'Bearer '+jwt,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10',
      'Content-Type':'application/json'},
     body:JSON.stringify({repository_ids:[ULTRON_REPOSITORY_ID],permissions}),
    });
  }catch{throw Error('GitHub App token exchange unavailable');}
  if(!response?.ok||response.status!==201)
   throw Error('GitHub App token exchange denied');
  let body;
  try{body=await response.json();}
  catch{throw Error('GitHub App token response invalid');}
  const expiry=parseInstant(body?.expires_at);
  if(typeof body?.token!=='string'||!body.token||
     !exactPermissions(body.permissions,permissions)||
     !Array.isArray(body.repositories)||body.repositories.length!==1||
     body.repositories[0]?.id!==ULTRON_REPOSITORY_ID||
     body.repositories[0]?.full_name!==ULTRON_REPOSITORY||
     !(expiry>now&&expiry<=now+3600_000))
   throw Error('GitHub App token response scope or profile invalid');
  return Object.freeze({token:body.token,repositoryId:ULTRON_REPOSITORY_ID,
   operation:request.operation,installationId,permissions,
   expiresAt:new Date(expiry).toISOString()});
 };
}

/**
 * PostgreSQL-backed nonce admission. The INSERT is the only success path:
 * duplicate, expired, denied, or uncertain database outcomes fail closed.
 * Migration 0037 installs a global unique nonce key.
 */
export function createPostgresApprovalNonceStore({db}={}){
 if(typeof db?.query!=='function')throw Error('durable nonce ledger required');
 return Object.freeze({consume:async({nonce,toolName,targetResource,timestamp})=>{
  if(!NONCE.test(nonce||'')||typeof toolName!=='string'||
     typeof targetResource!=='string'||!Number.isSafeInteger(timestamp))return false;
  try{
   const result=await db.query(
    `INSERT INTO brain_github_approval_nonces
      (nonce, operation, target_resource, approval_timestamp, expires_at)
     SELECT $1,$2,$3,to_timestamp($4/1000.0),
            to_timestamp(($4+300000)/1000.0)
     WHERE to_timestamp(($4+300000)/1000.0)>clock_timestamp()
     ON CONFLICT (nonce) DO NOTHING RETURNING nonce`,
    [nonce,toolName,targetResource,timestamp]);
   return result?.rows?.length===1&&result.rows[0]?.nonce===nonce;
  }catch{return false;}
 }});
}
