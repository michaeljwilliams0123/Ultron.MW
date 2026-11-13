/**
 * Task 2: cryptographic owner approval admission and Council persona tagging.
 *
 * Trusted backend only. A role is attribution, not a GitHub identity or
 * permission. Signature authority, a durable nonce store and the Task 1 token
 * factory are injected by the authenticated server composition root; nothing
 * in an inbound operation request may provide those dependencies.
 *
 * The caller MUST still run the operation-specific plan validator and durable
 * reserve-before-write executor. This interceptor never performs a GitHub write.
 */
import {createHash} from 'node:crypto';
import {
 verifyCryptographicApproval,createPostgresApprovalNonceStore,
} from '../security/crypto_auth.mjs';
import {COUNCIL_APP_ROLES} from '../council-app-bindings.mjs';
import {
 requiredTokenPermissions,ULTRON_REPOSITORY,
 ULTRON_REPOSITORY_ID,parseInstant,
} from '../github-principal-policy.mjs';

const SCHEMA='ultron.github.operation.v1';
const RESOURCE_PREFIX='ultron:github:'+ULTRON_REPOSITORY+':sha256:';
const APPROVAL_TTL_MS=300_000;
// A caller-provided authorized:true is not a cryptographic approval.
const AUTHENTIC_APPROVALS=new WeakSet();
export function isCryptographicallyApprovedOperation(value){
 return !!value&&typeof value==='object'&&AUTHENTIC_APPROVALS.has(value);
}
const PLAN_KEYS=['schema','repository','operation','activeAgentRole',
 'idempotencyKey','permittedScope','parameters'];
const SCOPE_KEYS=['operation','repositoryId','permissions'];

function deny(message){
 throw Error('Task 2 Security Error: '+message);
}
function exact(value,keys){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&
  Object.keys(value).every(key=>keys.includes(key));
}

/** Reject coercion, accessors, cycles, exotic data, and oversized plans. */
function plainJson(value,depth=0){
 if(depth>24)deny('invalid approval plan');
 if(value===null||typeof value==='string'||typeof value==='boolean')
  return;
 if(typeof value==='number'){
  if(!Number.isFinite(value))deny('invalid approval plan');
  return;
 }
 if(typeof value!=='object')deny('invalid approval plan');
 if(!Array.isArray(value)){
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)
   deny('invalid approval plan');
 }
 if(Object.getOwnPropertySymbols(value).length)
  deny('invalid approval plan');
 for(const [key,descriptor] of Object.entries(
  Object.getOwnPropertyDescriptors(value))){
  if(!Object.hasOwn(descriptor,'value')||
     key==='__proto__'||key==='constructor'||key==='prototype')
   deny('invalid approval plan');
  plainJson(descriptor.value,depth+1);
 }
}
function snapshot(value){
 try{
  plainJson(value);
  const text=JSON.stringify(value);
  if(typeof text!=='string'||Buffer.byteLength(text)>65536)
   deny('invalid approval plan');
  return JSON.parse(text);
 }catch{
  deny('invalid approval plan');
 }
}
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
function samePermissions(actual,expected){
 return exact(actual,Object.keys(expected))&&
  Object.entries(expected).every(([key,value])=>actual[key]===value);
}
function canonRole(role){
 if(typeof role!=='string')deny('unrecognized Council role');
 const canonical=COUNCIL_APP_ROLES.find(
  member=>member.toLowerCase()===role.toLowerCase());
 if(!canonical)deny('unrecognized Council role');
 return canonical;
}
function validatedPlan(input,role){
 if(!exact(input,PLAN_KEYS)||input.schema!==SCHEMA||
    input.repository!==ULTRON_REPOSITORY||
    canonRole(input.activeAgentRole)!==role||
    typeof input.idempotencyKey!=='string'||
    !/^[a-z0-9][a-z0-9:_-]{7,127}$/.test(input.idempotencyKey)||
    !input.parameters||typeof input.parameters!=='object'||
    Array.isArray(input.parameters))
  deny('invalid approval plan or Council role');
 let permissions;
 try{
  permissions=requiredTokenPermissions(input.operation);
 }catch{
  deny('operation profile denied');
 }
 const expectedScope={
  operation:input.operation,repositoryId:ULTRON_REPOSITORY_ID,permissions
 };
 if(!exact(input.permittedScope,SCOPE_KEYS)||
    input.permittedScope.operation!==expectedScope.operation||
    input.permittedScope.repositoryId!==expectedScope.repositoryId||
    !samePermissions(input.permittedScope.permissions,permissions))
  deny('requested token scope denied');
 return Object.freeze({
  operation:input.operation,repositoryId:ULTRON_REPOSITORY_ID,
  permissions:Object.freeze({...permissions})
 });
}
function validateToken(grant,scope,installationId,now){
 if(!grant||typeof grant!=='object'||Array.isArray(grant)||
    typeof grant.token!=='string'||grant.token.length===0||
    grant.repositoryId!==scope.repositoryId||
    grant.operation!==scope.operation||
    grant.installationId!==installationId||
    !samePermissions(grant.permissions,scope.permissions))
  deny('scoped token profile denied');
 const expiry=parseInstant(grant.expiresAt);
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+3600000)
  deny('scoped token expired or invalid');
 return grant.token;
}

/**
 * @param {object} operationRequest - untrusted signedGrant, nonce, signature,
 *   execution payload and activeAgentRole; no keys or trust declarations.
 * @param {object} tokenFactory - verified Task 1 server-only getTokenForScope.
 * @param {object} trusted - server-only {db,trustedKey,algorithm,
 *   expectedInstallationId,clock}; db implements query(sql,parameters).
 * @returns {object} Token-bearing result for internal execution only.
 */
export async function enforceSignedApprovalAndTagPersona(
 operationRequest,tokenFactory,trusted={}){
 if(typeof tokenFactory?.getTokenForScope!=='function'||
    typeof trusted?.db?.query!=='function'||
    !Number.isSafeInteger(trusted?.expectedInstallationId)||
    trusted.expectedInstallationId<1||
    typeof trusted.clock!=='function')
  deny('trusted approval and token factory configuration required');

 // Complete the immutable snapshot before awaiting signature verification.
 const payload=snapshot(operationRequest?.payload);
 const signedGrant=snapshot(operationRequest?.signedGrant);
 const role=canonRole(operationRequest?.activeAgentRole);
 const scopedRequest=validatedPlan(payload,role);
 const now=trusted.clock();
 if(!Number.isSafeInteger(now))deny('invalid trusted clock');
 if(typeof operationRequest?.nonce!=='string'||
    operationRequest.nonce!==signedGrant.nonce)
  deny('signed approval nonce invalid');

 const planDigest=createHash('sha256')
  .update(JSON.stringify(payload)).digest('hex');
 const resource=RESOURCE_PREFIX+planDigest;
 // Existing verifier authenticates the exact immutable plan digest, expiry,
 // operation and nonce before consuming migration 0037's unique-key row.
 const accepted=await verifyCryptographicApproval(
  signedGrant,operationRequest.signature,trusted.trustedKey,{
   algorithm:trusted.algorithm??'hmac-sha256',
   now,
   nonceStore:createPostgresApprovalNonceStore({db:trusted.db}),
   expectedToolName:payload.operation,
   expectedTargetResource:resource
  });
 if(!accepted)deny('invalid, expired or replayed approval');

 // A nonce remains consumed on provider failure; a retry needs a NEW grant.
 // Issue only this action's exact repository-ID/permission-scoped token.
 let issued;
 try{
  issued=await tokenFactory.getTokenForScope(scopedRequest);
 }catch{
  // Provider exceptions may embed authorization headers or credential text.
  deny('scoped token issuance unavailable');
 }
 const completedAt=trusted.clock();
 if(!Number.isSafeInteger(completedAt)||completedAt<now||
    completedAt>=Math.min(signedGrant.timestamp+APPROVAL_TTL_MS,
                          now+APPROVAL_TTL_MS))
  deny('signed approval expired before token issuance completed');
 const token=validateToken(
  issued,scopedRequest,trusted.expectedInstallationId,completedAt);
 const slug=role.toLowerCase();
 const persona=Object.freeze({
  role,authorName:'Ultron.MW ['+role+']',
  authorEmail:'ultron-mw-'+slug+'@system.local',
  commitMessagePrefix:'[autonomy:'+slug+']',
  attributionOnly:true
 });
 const commitHeaders=deepFreeze({
  author:{name:persona.authorName,email:persona.authorEmail},
  messagePrefix:persona.commitMessagePrefix,
  trailers:{'Ultron-Role':role,'Ultron-App-Principal':'ultron-github-app'}
 });
 // Keep the token retrievable by the trusted executor, but never included
 // in normal JSON serialization, object spreading or console inspection.
 const result={
  authorized:true,persona,commitHeaders,
  executionPayload:deepFreeze(payload)
 };
 // Store the credential in a private lexical closure. Even diagnostic
 // inspection with showHidden:true sees an accessor, not secret bytes.
 Object.defineProperty(result,'token',{
  get(){return token;},enumerable:false
 });
 const approved=Object.freeze(result);
 AUTHENTIC_APPROVALS.add(approved);
 return approved;
}
