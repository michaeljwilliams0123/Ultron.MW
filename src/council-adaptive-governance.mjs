/**
 * Adaptive governance v3, SHADOW ONLY. No result from this module authorizes
 * merging or deployment. All inputs are trusted-main observations; candidate
 * prose, labels, and policy files cannot choose their own tier.
 */
import {classifyTrustedRisk,councilExactHeadCiReady} from './council-trusted-gate.mjs';
import {buildCouncilExactHeadEvidence} from './council-exact-head-evidence.mjs';

const SHA=/^[a-f0-9]{40}$/;
const ROLES=Object.freeze(['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']);
const MODELS=Object.freeze(['Builder','Skeptic','Sentinel']);
const THRESHOLDS=Object.freeze([4,5,6,7,7]);
const TIERS=Object.freeze(['administrative','low','standard','high','critical']);
const REPO_ID=1424939667;
const REPO='michaeljwilliams0123/Ultron.MW';
const canonical=r=>r?.id===REPO_ID&&r?.full_name===REPO;
const code=/\.(?:mjs|cjs|js|ts|tsx|jsx)$/i;
// Explicit additional sensitive paths close known v2 classifier gaps.
const CRITICAL=/(?:^|\/)(?:council-[^/]*|release-(?:proof|standing-policy|authoriz[^/]*|owner|gate|attest[^/]*|receipt[^/]*|event[^/]*)|standing-policy|webauthn[^/]*|autonomy[^/]*|owner-[^/]*|hatchable-manifest[^/]*|[^/]*(?:credential|passkey|permission|signature|signing|secret|token|oidc|ruleset|auth)[^/]*)(?:\.[^/]*)?$/i;
const safePath=p=>typeof p==='string'&&p.length<=240&&/^[A-Za-z0-9_.\/-]+$/.test(p)&&!p.split('/').some(x=>x===''||x==='.'||x==='..');
const tierFor=p=>{
 if(CRITICAL.test(p)||/^(?:\.github|config|src\/security)\//.test(p)||/^package(?:-lock)?\.json$/.test(p)||/^scripts\/(?:verify|enforce|lint-workflows)/.test(p))return 4;
 if(/^docs\/[A-Za-z0-9_.\/-]+\.(?:md|txt)$/i.test(p)||/^(?:README|CHANGELOG)\.md$/.test(p))return 0;
 if(/^cloud\/hatchable\/public\/[A-Za-z0-9_.\/-]+\.css$/i.test(p))return 1;
 if(/^(?:src|test)\/[A-Za-z0-9_.\/-]+\.(?:mjs|js|cjs|ts|tsx|jsx)$/i.test(p))return 2;
 return 3; // default high; unknown paths never receive a low classification
};
export function classifyAdaptiveRisk({files,filesComplete}={}){
 const previous=classifyTrustedRisk({files,filesComplete});
 if(!previous.complete||!files.every(f=>safePath(f.filename)&&(f.previous_filename===undefined||safePath(f.previous_filename))))return Object.freeze({tier:4,name:TIERS[4],requiredCount:7,complete:false,paths:[]});
 const paths=[...new Set(files.flatMap(f=>[f.filename,f.previous_filename].filter(Boolean)))].sort();
 const tier=previous.security?4:Math.max(...paths.map(tierFor));
 return Object.freeze({tier,name:TIERS[tier],requiredCount:THRESHOLDS[tier],complete:true,paths:Object.freeze(paths)});
}
const validEvidenceRefs=a=>Array.isArray(a)&&a.length>0&&a.every(x=>typeof x==='string'&&x.length>0);
const empty=a=>Array.isArray(a)&&a.length===0;
const advisory=v=>v==='advisory'||v==='abstain';
const outage=m=>m?.modelInvoked===false&&empty(m.disagreements)&&
 ((m.source==='deterministic-fallback'&&['no-credentials','free-tier-exhausted-or-failed'].includes(m.fallbackReason))||m.source==='unavailable');
export function evaluateAdaptiveShadow({pr,files,filesComplete,report,receipt,ci,roleVerification,taint,legacy}={}){
 const risk=classifyAdaptiveRisk({files,filesComplete});
 const sourceSha=pr?.head?.sha,baseSha=pr?.base?.sha,prNumber=pr?.number;
 const details={schema:'ultron.council-adaptive-shadow.v1',policyVersion:3,mode:'shadow',authorizesMerge:false,
  sourceSha,baseSha,prNumber,riskTier:risk.tier,riskName:risk.name,requiredCount:risk.requiredCount,
  approvedCount:0,nonApprovals:[],unavailableModels:[],paidSpendAuthorizedUsd:0};
 const result=(decision,reason)=>Object.freeze({...details,decision,reason});
 if(!risk.complete)return result('held','changed-file-inventory-incomplete');
 if(pr?.state!=='open'||!Number.isSafeInteger(prNumber)||prNumber<1||!SHA.test(sourceSha||'')||!SHA.test(baseSha||'')||
  pr.base?.ref!=='main'||!canonical(pr.head?.repo)||!canonical(pr.base?.repo)||
  legacy?.sourceSha!==sourceSha||legacy?.baseSha!==baseSha||legacy?.prNumber!==prNumber)
  return result('held','target-provenance-invalid');
 if(ci?.pr?.number!==prNumber||ci.pr.head?.sha!==sourceSha||ci.pr.base?.sha!==baseSha||
  ci.comparison?.behind_by!==0||!councilExactHeadCiReady(ci.checkRuns,sourceSha))
  return result('held','exact-head-ci-incomplete');
 if(roleVerification?.schema!=='ultron.council-role-attestation-verification.v1'||roleVerification.verified!==true||
  roleVerification.rolesVerified!==7||roleVerification.sourceSha!==sourceSha||roleVerification.authority!=='shared-council-controller')
  return result('held','role-attestations-unverified');
 if(report?.isPr!==true||report.itemNumber!==prNumber||report.sourceSha!==sourceSha||
  !Array.isArray(report.memberAssessments)||report.memberAssessments.length!==7||
  !Array.isArray(receipt?.publication?.members)||receipt.publication.members.length!==7)
  return result('held','role-evidence-incomplete');
 if(taint?.schema!=='ultron.council-taint-evidence.v1'||taint.sourceSha!==sourceSha||taint.prNumber!==prNumber||
  taint.complete!==true||!Array.isArray(taint.reports))
  return result('held','source-screening-incomplete');
 const expected=files.filter(f=>f.status!=='removed'&&code.test(f.filename)).map(f=>f.filename).sort();
 const actual=taint.reports.map(r=>r.file).sort();
 if(taint.candidateFiles!==expected.length||taint.scannedFiles!==expected.length||actual.length!==expected.length||
  expected.some((p,i)=>p!==actual[i]))
  return result('held','source-screening-coverage-incomplete');
 if(taint.reports.some(r=>r.status!=='no-known-flow'||r.unknownCount!==0||!empty(r.findings)))
  return result('held','material-or-unclassified-source-finding');
 const members=new Map(),published=new Map();
 for(const m of report.memberAssessments){
  const role=m?.identity?.role;if(!ROLES.includes(role)||members.has(role))return result('held','duplicate-or-unknown-role');
  members.set(role,m);
 }
 for(const p of receipt.publication.members){
  const role=ROLES.find(r=>'ultron-'+r.toLowerCase()===p?.roleId);
  if(!role||published.has(role))return result('held','duplicate-or-unknown-publication');
  published.set(role,p);
 }
 let unresolved=false,nonMaterialAdvisories=0;
 const exact=buildCouncilExactHeadEvidence(ci);
 const changedTests=files.some(f=>['added','modified'].includes(f.status)&&/^test\/[A-Za-z0-9_.\/-]+\.test\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(f.filename));
 for(const role of ROLES){
  const m=members.get(role),p=published.get(role);
  if(!m||!p||!empty(p.unknowns)||!empty(p.dissentTags)||!validEvidenceRefs(p.evidenceRefs)){unresolved=true;details.nonApprovals.push(role);continue;}
  if(m.verdict==='proceed'&&p.conclusion==='proceed')details.approvedCount++;
  else {
   details.nonApprovals.push(role);
   // The real legacy producer retains its HOLD; no vote is manufactured.
   // Only a deterministic prose objection, with changed tests, exact CI,
   // clean publication and affirmative independent model analysis, is advisory.
   const model=receipt.modelReview?.results?.Skeptic;
   const proseOnly=role==='Skeptic'&&risk.tier<=2&&m.verdict==='hold'&&p.conclusion==='proceed'&&
    m.advisoryReason==='missing-test-prose-with-verified-ci'&&changedTests&&exact.verified===true&&
    exact.sourceSha===sourceSha&&exact.baseSha===baseSha&&exact.prNumber===prNumber&&
    model?.source==='model'&&model.modelInvoked===true&&model.verdict==='proceed'&&
    empty(model.disagreements)&&empty(model.findings);
   if(proseOnly)nonMaterialAdvisories++;
   else if(!advisory(m.verdict)||m.verdict!==p.conclusion)unresolved=true;
  }
 }
 if(details.approvedCount!==legacy.approvedCount)return result('held','legacy-role-count-mismatch');
 if(unresolved)return result('held','material-or-unclassified-role-dissent');
 for(const role of MODELS){
  const m=receipt.modelReview?.results?.[role];
  if(outage(m)){details.unavailableModels.push(role);continue;}
  if(m?.source!=='model'||m.modelInvoked!==true||m.verdict!=='proceed'||!empty(m.disagreements)||
   !Array.isArray(m.findings)||m.findings.length!==0)
   return result('held','material-or-unclassified-model-dissent');
 }
 if(details.approvedCount<risk.requiredCount)return result('held','tier-quorum-not-met');
 if(details.approvedCount===7&&(report.hold!==false||receipt.decision!=='proceed'))
  return result('held','unexplained-governor-hold');
 if(details.approvedCount<7){
  const governorHeld=report.hold===true&&receipt.decision==='hold';
  const governorProceed=report.hold===false&&receipt.decision==='proceed'&&
   nonMaterialAdvisories===details.nonApprovals.length;
  if(!governorHeld&&!governorProceed)return result('held','inconsistent-governor-evidence');
 }
 if(risk.tier===4)return result('held','critical-owner-authority-and-enhanced-validation-required');
 if(risk.tier===3)return result('held','enhanced-validation-required');
 // The existing role signatures are shared-controller attestations, not seven
 // independent accounts. A provider outage is retained separately, never a vote.
 if(details.unavailableModels.length>1)return result('held','multiple-model-outages');
 return result('eligible','shadow-quorum-satisfied');
}
