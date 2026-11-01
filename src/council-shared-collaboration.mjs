/** C04 shared council case: common durable-input contract, not model execution.
 * Each role receives the same exact evidence and lifecycle snapshot plus its
 * specialist evaluation lens. Independent thought/execution is never claimed.
 */
import {createHash} from 'node:crypto';
import {COUNCIL_APP_ROLES} from './council-app-identities.mjs';

export const COUNCIL_LIFECYCLE=Object.freeze([
 'intake','plan','authorize','execute','verify','persist','learn'
]);
export const SME_DOMAINS=Object.freeze({
 Builder:Object.freeze({domain:'Engineering architecture and implementation',
  evidenceQuestions:Object.freeze([
   'What change and failing regression demonstrate the required behavior?',
   'Which exact source SHA and CI run prove reproducibility?'])}),
 Skeptic:Object.freeze({domain:'Falsification and adversarial validation',
  evidenceQuestions:Object.freeze([
   'Which assumption would invalidate the proposed conclusion?',
   'Which negative test or counterexample disproves the happy path?'])}),
 Steward:Object.freeze({domain:'Authorization, governance and source provenance',
  evidenceQuestions:Object.freeze([
   'Which independent authority approved the particular effect and scope?',
   'Which protected-release and rollback gates remain unproven?'])}),
 Predictor:Object.freeze({domain:'Outcomes, scenarios and uncertainty',
  evidenceQuestions:Object.freeze([
   'What alternative outcomes follow this change under failure?',
   'Which observations would change the current probability assessment?'])}),
 Generator:Object.freeze({domain:'Alternative implementations and improvements',
  evidenceQuestions:Object.freeze([
   'Which different implementation could remove a dependency or cost?',
   'What tradeoffs and exact experiments would evaluate that alternative?'])}),
 Sentinel:Object.freeze({domain:'Operational safety, drift and reliability',
  evidenceQuestions:Object.freeze([
   'Which live telemetry proves recovery, latency and no duplicate effects?',
   'What monitoring signal triggers a hold or a bounded repair?'])}),
 Companion:Object.freeze({domain:'Owner intent, priority and continuity',
  evidenceQuestions:Object.freeze([
   'Does this action preserve the complete latest authorized owner intent?',
   'Which unresolved user requirement or dependency changes priority?'])})
});
const CASES=new WeakSet();
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
function reject(error){throw Error('council-shared-'+error);}
function sortedUnique(values,expression,max=25){
 if(!Array.isArray(values)||values.length>max||
    values.some(value=>typeof value!=='string'||!expression.test(value)))
  reject('evidence-invalid');
 return Object.freeze([...new Set(values)].sort());
}
export function createSharedCouncilCase(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
   input.repository!=='michaeljwilliams0123/Ultron.MW'||
   typeof input.objectiveId!=='string'||
   !/^[a-z0-9][a-z0-9:-]{7,100}$/.test(input.objectiveId)||
   !SHA64.test(input.taskFingerprint||'')||
   !SHA40.test(input.sourceSha||'')||
   typeof input.ownerIntent!=='string'||
   !input.ownerIntent.trim()||input.ownerIntent.length>1500||
   !COUNCIL_LIFECYCLE.includes(input.lifecycle)||
   !input.constraints||typeof input.constraints!=='object'||
   input.constraints.maxPaidCents!==0||
   input.constraints.independentReviewRequired!==true)
  reject('input-invalid');
 const blockedBy=sortedUnique(input.blockedBy,/^#[1-9]\d{0,7}$/);
 const evidenceRefs=sortedUnique(input.evidenceRefs,
  /^https:\/\/github\.com\/michaeljwilliams0123\/(?:Ultron\.MW|mahoraga)\/(?:pull|issues|actions\/runs|commit)\/[a-zA-Z0-9/#-]+$/);
 const core=Object.freeze({
  schema:'ultron.council.shared-case.v1',
  repository:input.repository,objectiveId:input.objectiveId,
  taskFingerprint:input.taskFingerprint,sourceSha:input.sourceSha,
  ownerIntent:input.ownerIntent.trim(),lifecycle:input.lifecycle,
  blockedBy,evidenceRefs,
  constraints:Object.freeze({maxPaidCents:0,independentReviewRequired:true}),
  process:COUNCIL_LIFECYCLE
 });
 const caseSha=createHash('sha256').update(JSON.stringify(core)).digest('hex');
 const shared=Object.freeze({...core,caseSha});
 CASES.add(shared);
 return shared;
}
function trustedCase(shared){
 if(!CASES.has(shared))reject('unverified-case');
}
export function createSMEAssignment(shared,role){
 trustedCase(shared);
 if(!Object.hasOwn(SME_DOMAINS,role))reject('role-invalid');
 return Object.freeze({
  role,caseSha:shared.caseSha,shared,
  expertise:SME_DOMAINS[role],
  roleTask:'Provide an evidence-based, falsifiable SME assessment; preserve disagreement.',
  modelBacked:false,githubPrincipal:null,independentlyAuthenticated:false,
  releaseAuthority:'none'
 });
}
export function collectCouncilAssessments(shared,assessments){
 trustedCase(shared);
 if(!Array.isArray(assessments)||assessments.length<1||
   assessments.length>COUNCIL_APP_ROLES.length*2)
  reject('members-invalid');
 const seen=new Set();
 const positions=[];
 for(const item of assessments){
  if(!item||!Object.hasOwn(SME_DOMAINS,item.role))reject('role-invalid');
  if(seen.has(item.role))reject('duplicate-role');
  seen.add(item.role);
  if(item.caseSha!==shared.caseSha)reject('case-mismatch');
  if(!['proceed','hold','needs-evidence'].includes(item.position)||
     typeof item.rationale!=='string'||!item.rationale.trim()||
     item.rationale.length>1200)
    reject('assessment-invalid');
  if(item.modelBacked===true||item.githubPrincipal)
    reject('identity-unverified');
  const evidenceRefs=sortedUnique(item.evidenceRefs,
   /^https:\/\/github\.com\/michaeljwilliams0123\/(?:Ultron\.MW|mahoraga)\/(?:pull|issues|actions\/runs|commit)\/[a-zA-Z0-9/#-]+$/);
  const unknowns=sortedUnique(item.unknowns,/^[a-z0-9][a-z0-9 -]{0,160}$/);
  positions.push(Object.freeze({role:item.role,position:item.position,
   rationale:item.rationale,evidenceRefs,unknowns,modelBacked:false,
   githubPrincipal:null,independentlyAuthenticated:false}));
 }
 if(positions.length!==COUNCIL_APP_ROLES.length)
  reject('members-invalid');
 positions.sort((a,b)=>COUNCIL_APP_ROLES.indexOf(a.role)-COUNCIL_APP_ROLES.indexOf(b.role));
 const distinct=new Set(positions.map(p=>p.position));
 const perRole=Object.freeze(positions);
 return Object.freeze({
  caseSha:shared.caseSha,memberCount:positions.length,positions:perRole,perRole,
  disagreement:distinct.size>1,releaseApproved:false,
  independentExecutionProven:false,modelInvocationsVerified:0,
  assessmentType:'deterministic-advisory-until-identity-and-model-evidence'
 });
}
