/**
 * Read-only, post-dispatch verification. The writer's HTTP success, UI claims,
 * or output are never accepted as the independent readback. All services are
 * injected by a trusted execution composition root, not by MCP _meta fields.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from './canonical_json.mjs';

const REPO='/repos/michaeljwilliams0123/Ultron.MW/';
const GITHUB_PATH=/^\/(?:pulls\/[1-9]\d*|issues\/[1-9]\d*|commits\/[a-f0-9]{40}|actions\/runs\/[1-9]\d*|git\/ref\/heads\/[a-zA-Z0-9._/-]+|branches\/[a-zA-Z0-9._/-]+)$/;
const FIELDS=new Set(['state','merged','sha','head.sha','object.sha','conclusion','status','id','number']);
const TIERS=Object.freeze({http_status:'transport-only',dom_element_present:'dom-only',
 github_api_readback:'provider-state',database_readback:'provider-state'});
const ATTEMPT=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,127}$/;
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const result=(ok,tier,reason)=>Object.freeze({ok,tier,reason});

function externalUrl(value,allowedOrigins){
 if(typeof value!=='string'||value.length>512)throw Error('url-invalid');
 let url;
 try{url=new URL(value);}catch{throw Error('url-invalid');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
    url.search||!Array.isArray(allowedOrigins)||
    !allowedOrigins.includes(url.origin))throw Error('url-denied');
 return url;
}
function githubUrl(raw){
 const url=externalUrl(raw,['https://api.github.com']);
 if(!url.pathname.startsWith(REPO)||
    !GITHUB_PATH.test(url.pathname.slice(REPO.length-1)))
  throw Error('github-readback-resource-denied');
 return url;
}
function expectedField(assertion){
 const field=assertion.expectedField??'state';
 if(!FIELDS.has(field))throw Error('readback-field-denied');
 return field;
}
function observationField(data,field){
 let value=data;
 for(const part of field.split('.')){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     !Object.hasOwn(value,part))return undefined;
  value=value[part];
 }
 return value;
}
function assertionShape(assertion){
 if(!assertion||typeof assertion!=='object'||Array.isArray(assertion)||
   !Object.hasOwn(TIERS,assertion.checkType)||
   typeof assertion.targetEndpointOrSelector!=='string'||
   assertion.targetEndpointOrSelector.length===0||
   assertion.targetEndpointOrSelector.length>512||
   !['string','number','boolean'].includes(typeof assertion.expectedValue))
  throw Error('readback-assertion-invalid');
 return TIERS[assertion.checkType];
}

/** A single bounded, fresh observation. Network failures are uncertain, not proof of absence. */
export async function observeExternalEffect(assertion,services={}){
 let tier='unknown';
 try{
  tier=assertionShape(assertion);
  const {checkType,targetEndpointOrSelector:target,expectedValue}=assertion;
  if(checkType==='http_status'||checkType==='github_api_readback'){
   const url=checkType==='github_api_readback'?githubUrl(target):
    externalUrl(target,services.allowedOrigins);
   if(checkType==='http_status'&&(!Number.isInteger(expectedValue)||
      expectedValue<100||expectedValue>599))throw Error('http-status-invalid');
   const fetcher=services.fetcher??fetch;
   if(typeof fetcher!=='function')throw Error('fetch-unavailable');
   const headers={accept:'application/json'};
   if(checkType==='github_api_readback'){
    // The token may only come from the trusted service constructor.
    if(services.githubToken!==undefined){
     if(typeof services.githubToken!=='string'||services.githubToken.length<8)
      throw Error('github-token-invalid');
     headers.authorization='Bearer '+services.githubToken;
    }
   }
   const response=await fetcher(url.toString(),{method:'GET',headers,
    redirect:'error',cache:'no-store',signal:services.signal});
   if(!response||!Number.isInteger(response.status))
    throw Error('readback-response-invalid');
   if(checkType==='http_status')
    return result(response.status===expectedValue,tier,
     response.status===expectedValue?'matched':'mismatch');
   if(response.status!==200||response.ok!==true)return result(false,tier,'mismatch');
   const body=await response.json();
   if(!body||typeof body!=='object'||Array.isArray(body))
    return result(false,tier,'mismatch');
   const matched=observationField(body,expectedField(assertion))===expectedValue;
   return result(matched,tier,matched?'matched':'mismatch');
  }
  if(checkType==='dom_element_present'){
   if(typeof services.domReadback!=='function'||
     typeof assertion.allowedOrigin!=='string'||
     assertion.allowedOrigin.length>150||
     assertion.allowedOrigin!==new URL(assertion.allowedOrigin).origin||
     !Array.isArray(services.allowedOrigins)||
     !services.allowedOrigins.includes(assertion.allowedOrigin)||
     target.length>250||/[\u0000-\u001f]/.test(target))
    throw Error('dom-reader-or-origin-denied');
   const observed=await services.domReadback({selector:target,origin:assertion.allowedOrigin});
   const matched=observed?.present===true&&observed?.visible===true&&
    observed.origin===assertion.allowedOrigin&&
    (expectedValue==='present'||observed.text===expectedValue);
   return result(matched,tier,matched?'matched':'mismatch');
  }
  if(checkType==='database_readback'){
   if(typeof services.databaseReadback!=='function'||
     typeof assertion.correlationKey!=='string'||
     !ATTEMPT.test(assertion.correlationKey)||
     !/^[a-z][a-z0-9_]*:[a-zA-Z0-9._:-]{5,128}$/.test(target))
    throw Error('database-reader-invalid');
   const field=expectedField(assertion);
   const row=await services.databaseReadback({resource:target,
    correlationKey:assertion.correlationKey});
   const matched=row?.committed===true&&
    row.correlationKey===assertion.correlationKey&&
    observationField(row,field)===expectedValue;
   return result(matched,tier,matched?'matched':'mismatch');
  }
  return result(false,tier,'unsupported');
 }catch{
  // Do not copy thrown messages, response bodies, URLs, or credentials into receipts.
  return result(false,tier,'unavailable');
 }
}

/** Compatibility with the requested boolean API. Use the detailed API for settlement. */
export async function verifyExternalEffect(assertion,services={}){
 return (await observeExternalEffect(assertion,services)).ok;
}

/**
 * A trusted Hatchable adapter implements write(event) and read(attemptId).
 * Read MUST independently query durable state; an echoed POST response is
 * insufficient. No mutation is replayed, even when reporting fails.
 */
export async function verifyAndReportExternalEffect({attemptId,assertions,services={},reporter}={}){
 if(typeof attemptId!=='string'||!ATTEMPT.test(attemptId)||
   !Array.isArray(assertions)||assertions.length<1||assertions.length>8)
  throw Error('readback-attempt-invalid');
 const checks=[];
 for(const assertion of assertions){
  const observed=await observeExternalEffect(assertion,services);
  checks.push(Object.freeze({checkType:typeof assertion?.checkType==='string'?
     assertion.checkType:'invalid',tier:observed.tier,ok:observed.ok,
   reason:observed.reason,targetDigest:hash(assertion?.targetEndpointOrSelector??null),
   expectedDigest:hash([assertion?.expectedField??null,assertion?.expectedValue??null])}));
 }
 const unavailable=checks.some(c=>c.reason==='unavailable');
 const passed=checks.every(c=>c.ok);
 const durable=checks.some(c=>c.tier==='provider-state'&&c.ok);
 const status=unavailable?'reconcile-required':!passed?'not-verified':
  durable?'verified-external':'observed-only';
 const event={schema:'ultron.readback-oracle.v1',attemptId,status,
  checks,verifiedAt:new Date().toISOString()};
 event.evidenceDigest=hash(event);
 if(typeof reporter?.write!=='function'||typeof reporter?.read!=='function')
  return Object.freeze({status:'reconcile-required',persisted:false,
   evidenceDigest:event.evidenceDigest,reason:'hatchable-reporter-unavailable'});
 try{
  const write=await reporter.write(event);
  if(write?.ok!==true)throw Error('receipt-write-unconfirmed');
  const saved=await reporter.read(attemptId);
  if(saved?.schema!==event.schema||saved?.attemptId!==attemptId||
    saved?.status!==status||saved?.evidenceDigest!==event.evidenceDigest)
   throw Error('receipt-readback-mismatch');
  return Object.freeze({status,persisted:true,evidenceDigest:event.evidenceDigest});
 }catch{
  return Object.freeze({status:'reconcile-required',persisted:false,
   evidenceDigest:event.evidenceDigest,reason:'hatchable-receipt-reconcile-required'});
 }
}
