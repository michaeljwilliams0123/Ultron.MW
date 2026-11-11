/**
 * Council release acceptance. Seven logical role votes are NOT seven independent
 * identities, reviews or authorizations. This is an exact-head release floor.
 * The only exception is an explicit GitHub-authenticated owner comment tied to
 * BOTH current PR head and base. It never bypasses tests or branch rules.
 */
import {COUNCIL_ROLES} from './council-publication.mjs';
import {createPublicKey,verify as verifySignature} from 'node:crypto';

const SHA=/^[a-f0-9]{40}$/;
const OWNER={login:'michaeljwilliams0123',id:308995719};
const MODEL_ROLES=Object.freeze(['Builder','Skeptic','Sentinel']);
const OVERRIDE=/^\/council override ([1-9][0-9]{0,8}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([a-f0-9]{32}) -- ([ -~]{20,240})\nsignature:p256:([A-Za-z0-9_-]{70,120})$/;
const EXPECTED=new Map(COUNCIL_ROLES.map(id=>[id,id.slice(7).replace(/^./,c=>c.toUpperCase())]));

export function validateOwnerOverride(comment,{sourceSha,baseSha,prNumber,now,
 ownerPublicJwk}={}){
 if(!comment||!SHA.test(sourceSha||'')||!SHA.test(baseSha||'')||
   !Number.isSafeInteger(prNumber)||prNumber<1||
   comment.user?.login!==OWNER.login||comment.user?.id!==OWNER.id||
   !Number.isSafeInteger(comment.id)||comment.id<1||
   typeof comment.body!=='string'||typeof comment.created_at!=='string'||
   comment.created_at!==comment.updated_at)return null;
 const match=OVERRIDE.exec(comment.body.trim());
 if(!match||Number(match[1])!==prNumber||
   match[2]!==sourceSha||match[3]!==baseSha||!match[5].trim())return null;
 const issued=Date.parse(comment.created_at),when=Date.parse(now||'');
 if(!Number.isFinite(issued)||!Number.isFinite(when)||
    issued>when+60000||when-issued>24*60*60*1000)return null;
 // The comment identity alone is insufficient: a stolen PAT must not authorize
 // an exception. Verify an owner-held P-256 signature over the exact PR, SHAs,
 // bounded nonce and reason using a separately configured public verification key.
 let key=ownerPublicJwk;
 try{
  if(typeof key==='string')key=JSON.parse(key);
  if(!key||key.kty!=='EC'||key.crv!=='P-256'||key.d!==undefined||
     !/^[A-Za-z0-9_-]{43}$/.test(key.x||'')||
     !/^[A-Za-z0-9_-]{43}$/.test(key.y||''))return null;
  const signature=Buffer.from(match[6],'base64url');
  if(signature.length<65||signature.length>80||
     signature.toString('base64url')!==match[6])return null;
  const payload=['ULTRON-COUNCIL-OVERRIDE-v1',
   'michaeljwilliams0123/Ultron.MW',String(prNumber),
   sourceSha,baseSha,match[4],match[5],''].join('\n');
  if(!verifySignature('sha256',Buffer.from(payload),
       createPublicKey({key,format:'jwk'}),signature))return null;
 }catch{return null;}
 return Object.freeze({commentId:comment.id,issuedAt:comment.created_at,
    reason:match[5],nonce:match[4],sourceSha,baseSha,prNumber,
    signatureVerified:true});
}

function held(reason,approvedCount=0,holdRoles=[],details={}){
 return Object.freeze({schema:'ultron.council-release-gate.v1',status:'held',
  reason,approvedCount,requiredCount:7,holdRoles:Object.freeze([...holdRoles]),
  modelHoldRoles:Object.freeze([]),overrideUsed:false,...details});
}
export function evaluateCouncilAcceptance({report,receipt,sourceSha,baseSha,
 prNumber,overrideComment=null,ownerPublicJwk=null,
 now=new Date().toISOString()}={}){
 if(!SHA.test(sourceSha||'')||!SHA.test(baseSha||'')||
  !Number.isSafeInteger(prNumber)||prNumber<1)
  return held('invalid-target');
 if(!report||typeof report!=='object'||report.isPr!==true||
   report.itemNumber!==prNumber||report.sourceSha!==sourceSha||
   !Array.isArray(report.memberAssessments)||!receipt||
   !Array.isArray(receipt.publication?.members))
  return held('missing-or-stale-council-evidence');
 const roleMap=new Map(),publicationMap=new Map();
 for(const m of report.memberAssessments){
  const id='ultron-'+String(m?.identity?.role??'').toLowerCase();
  if(!EXPECTED.has(id)||roleMap.has(id))return held('missing-or-duplicate-role');
  roleMap.set(id,m);
 }
 for(const m of receipt.publication.members){
  if(!EXPECTED.has(m?.roleId)||publicationMap.has(m.roleId))
   return held('missing-or-duplicate-publication');
  publicationMap.set(m.roleId,m);
 }
 if(roleMap.size!==7||publicationMap.size!==7)
  return held('incomplete-role-evidence');
 let approvedCount=0;
 const holdRoles=[];
 for(const [id,name] of EXPECTED){
  const vote=roleMap.get(id),published=publicationMap.get(id);
  const valid=vote?.identity?.role===name &&
    vote?.verdict==='proceed'&&published?.conclusion==='proceed'&&
    Array.isArray(published.unknowns)&&published.unknowns.length===0&&
    Array.isArray(published.dissentTags)&&published.dissentTags.length===0&&
    Array.isArray(published.evidenceRefs)&&published.evidenceRefs.length>0;
  if(valid)approvedCount++;else holdRoles.push(name);
 }
 // Model-backed reasoning is not interchangeable with the seven deterministic
 // role labels. A real model HOLD/REVISE, model outage, or unresolved concern
 // must block default acceptance rather than be disguised as 7/7 approval.
 const modelHoldRoles=MODEL_ROLES.filter(role=>{
  const m=receipt.modelReview?.results?.[role];
  return m?.source!=='model'||m?.modelInvoked!==true||
    m?.verdict!=='proceed'||!Array.isArray(m?.disagreements)||
    m.disagreements.length!==0;
 });
 const consensus=approvedCount===7&&report.hold===false&&
  receipt.decision==='proceed'&&modelHoldRoles.length===0;
 if(consensus)return Object.freeze({
  schema:'ultron.council-release-gate.v1',status:'accepted',reason:null,
  approvedCount,requiredCount:7,holdRoles:Object.freeze([]),overrideUsed:false,
  modelHoldRoles:Object.freeze([]),sourceSha,baseSha,prNumber
 });
 const override=validateOwnerOverride(overrideComment,{sourceSha,baseSha,prNumber,
  ownerPublicJwk,now});
 if(override)return Object.freeze({
  schema:'ultron.council-release-gate.v1',status:'owner-overridden',
  reason:'explicit-exact-commit-owner-override',approvedCount,requiredCount:7,
  holdRoles:Object.freeze(holdRoles),modelHoldRoles:Object.freeze(modelHoldRoles),
  overrideUsed:true,
  overrideCommentId:override.commentId,overrideReason:override.reason,
  overrideSignatureVerified:true,
  sourceSha,baseSha,prNumber
 });
 return held('council-not-unanimous',approvedCount,holdRoles,
  {modelHoldRoles:Object.freeze(modelHoldRoles),sourceSha,baseSha,prNumber});
}
