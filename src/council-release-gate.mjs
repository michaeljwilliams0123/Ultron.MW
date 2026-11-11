/**
 * Council release acceptance. Seven logical role votes are NOT seven independent
 * identities, reviews or authorizations. This is an exact-head release floor.
 * The only exception is an explicit GitHub-authenticated owner comment tied to
 * BOTH current PR head and base. It never bypasses tests or branch rules.
 */
import {COUNCIL_ROLES} from './council-publication.mjs';

const SHA=/^[a-f0-9]{40}$/;
const OWNER={login:'michaeljwilliams0123',id:308995719};
const MODEL_ROLES=Object.freeze(['Builder','Skeptic','Sentinel']);
const OVERRIDE=/^\/council override ([a-f0-9]{40}) ([a-f0-9]{40}) -- ([^\r\n]{20,240})$/;
const EXPECTED=new Map(COUNCIL_ROLES.map(id=>[id,id.slice(7).replace(/^./,c=>c.toUpperCase())]));

export function validateOwnerOverride(comment,{sourceSha,baseSha,now}={}){
 if(!comment||!SHA.test(sourceSha||'')||!SHA.test(baseSha||'')||
   comment.user?.login!==OWNER.login||comment.user?.id!==OWNER.id||
   !Number.isSafeInteger(comment.id)||comment.id<1||
   typeof comment.body!=='string'||typeof comment.created_at!=='string'||
   comment.created_at!==comment.updated_at)return null;
 const match=OVERRIDE.exec(comment.body.trim());
 if(!match||match[1]!==sourceSha||match[2]!==baseSha||
   !match[3].trim()||match[3].trim().length<20)return null;
 const issued=Date.parse(comment.created_at),when=Date.parse(now||'');
 if(!Number.isFinite(issued)||!Number.isFinite(when)||
    issued>when+60000||when-issued>24*60*60*1000)return null;
 return Object.freeze({commentId:comment.id,issuedAt:comment.created_at,
    reason:match[3].trim(),sourceSha,baseSha});
}
function held(reason,approvedCount=0,holdRoles=[],details={}){
 return Object.freeze({schema:'ultron.council-release-gate.v1',status:'held',
  reason,approvedCount,requiredCount:7,holdRoles:Object.freeze([...holdRoles]),
  modelHoldRoles:Object.freeze([]),overrideUsed:false,...details});
}
export function evaluateCouncilAcceptance({report,receipt,sourceSha,baseSha,
 prNumber,overrideComment=null,now=new Date().toISOString()}={}){
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
 const override=validateOwnerOverride(overrideComment,{sourceSha,baseSha,now});
 if(override)return Object.freeze({
  schema:'ultron.council-release-gate.v1',status:'owner-overridden',
  reason:'explicit-exact-commit-owner-override',approvedCount,requiredCount:7,
  holdRoles:Object.freeze(holdRoles),modelHoldRoles:Object.freeze(modelHoldRoles),
  overrideUsed:true,
  overrideCommentId:override.commentId,overrideReason:override.reason,
  sourceSha,baseSha,prNumber
 });
 return held('council-not-unanimous',approvedCount,holdRoles,
  {modelHoldRoles:Object.freeze(modelHoldRoles),sourceSha,baseSha,prNumber});
}
