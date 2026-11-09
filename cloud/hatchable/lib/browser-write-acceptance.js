import {createHash} from 'node:crypto';

/** A single harmless owner-approved effect persisted outside the browser worker.
 * This is NOT a general cloud-browser or arbitrary website write endpoint.
 */
const SHA=/^[a-f0-9]{40}$/;
const OBJECTIVE=/^[A-Za-z0-9._:-]{10,80}$/;
const MARKER=/^[A-Za-z][A-Za-z0-9_-]{3,79}$/;
const PHASES=new Set(['submit','readback']);
export const SCHEMA='ultron.browser-write.v1';
function exactKeys(x,keys){
 return x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===[...keys].sort().join(',');
}
export function parseBrowserWriteBody(raw){
 let body;
 try{body=JSON.parse(raw);}catch{throw Error('browser-write-invalid-json');}
 if(!exactKeys(body,['schema','phase','objectiveId','sourceSha','marker','issueNumber'])||
    body.schema!==SCHEMA||!PHASES.has(body.phase)||
    !OBJECTIVE.test(body.objectiveId||'')||!SHA.test(body.sourceSha||'')||
    !MARKER.test(body.marker||'')||!Number.isSafeInteger(body.issueNumber)||
    body.issueNumber<1||body.issueNumber>100000000)
  throw Error('browser-write-invalid-contract');
 if(/(?:password|secret|token|private|passcode|apikey)/i.test(body.marker))
  throw Error('browser-write-marker-denied');
 return body;
}
export function browserWriteDigest(body){
 return createHash('sha256').update(JSON.stringify({
  schema:SCHEMA,objectiveId:body.objectiveId,sourceSha:body.sourceSha,
  marker:body.marker,issueNumber:body.issueNumber
 })).digest('hex');
}
export async function applyBrowserWrite({db,body,identity}){
 if(identity?.actor!=='michaeljwilliams0123'||identity.sha!==body.sourceSha||
    identity.event!=='issues'||!SHA.test(identity.sha||''))
  return {ok:false,status:403,reason:'owner-oidc-scope-denied'};
 const digest=browserWriteDigest(body);
 let inserted=false;
 if(body.phase==='submit'){
  try{
   const result=await db.query(`INSERT INTO browser_acceptance_effects(
      objective_key,source_sha,approval_issue,request_digest,marker,actor)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(objective_key) DO NOTHING
     RETURNING id`,[
      body.objectiveId,body.sourceSha,body.issueNumber,digest,body.marker,identity.actor]);
   inserted=Array.isArray(result.rows)&&result.rows.length===1;
  }catch{
   // A dropped database acknowledgement might follow a committed write.
   // Never reissue the INSERT; use a separate read to reconcile.
   inserted=false;
  }
 }
 let found;
 try{
  const rows=(await db.query(`SELECT id,objective_key,source_sha,approval_issue,
     request_digest,marker,actor,created_at FROM browser_acceptance_effects
     WHERE objective_key=$1 LIMIT 2`,[body.objectiveId])).rows;
  if(rows?.length===1)found=rows[0];
 }catch{
  return {ok:false,status:503,reason:'browser-write-reconcile-required'};
 }
 if(!found)
  return {ok:false,status:body.phase==='readback'?404:503,
   reason:body.phase==='readback'?'browser-write-not-found':'browser-write-reconcile-required'};
 if(found.source_sha!==body.sourceSha||found.request_digest!==digest||
    Number(found.approval_issue)!==body.issueNumber||
    found.marker!==body.marker||found.actor!==identity.actor)
  return {ok:false,status:409,reason:'browser-write-idempotency-conflict'};
 const receiptId=Number(found.id);
 if(!Number.isSafeInteger(receiptId)||receiptId<=0)
  return {ok:false,status:503,reason:'browser-write-invalid-receipt'};
 return {ok:true,status:200,phase:body.phase,objectiveId:body.objectiveId,
  marker:body.marker,sourceSha:body.sourceSha,actor:identity.actor,
  approvalIssue:body.issueNumber,receiptId,effectCount:1,reused:!inserted};
}
