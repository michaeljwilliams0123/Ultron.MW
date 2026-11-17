import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCouncilEvidenceCoverage} from '../src/council-evidence-coverage.mjs';
import {evaluateCouncilAcceptance} from '../src/council-release-gate.mjs';
import {deriveCouncilRolePublicKeys,signCouncilRoleVerdict,verifyCouncilRoleVerdict}
 from '../src/council-role-attestation.mjs';

const HEAD='a'.repeat(40),BASE='b'.repeat(40),PR=474;
const roles=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
const preflight=scoreCouncilEvidenceCoverage({isPr:true,sourceSha:HEAD,prNumber:PR,
 reviewEvidence:{verified:true,sourceSha:HEAD,baseSha:BASE,prNumber:PR,baseUpToDate:true},
 fileEvidence:{complete:true,sourceSha:HEAD,baseSha:BASE,prNumber:PR,
   files:[{filename:'src/safe.mjs',patch:'@@ -1 +1 @@\n-a\n+b'}]}});
function completeFacts(){
 return {report:{itemNumber:PR,isPr:true,sourceSha:HEAD,hold:false,
  memberAssessments:roles.map(role=>({identity:{role},verdict:'proceed'}))},
  receipt:{decision:'proceed',publication:{members:roles.map(role=>({
   roleId:'ultron-'+role.toLowerCase(),conclusion:'proceed',
   unknowns:[],dissentTags:[],evidenceRefs:['trusted:exact-head']
  }))},modelReview:{results:Object.fromEntries(['Builder','Skeptic','Sentinel'].map(role=>
   [role,{source:'model',modelInvoked:true,verdict:'proceed',disagreements:[]}]))}}};
}
function acceptance(facts){return evaluateCouncilAcceptance({...facts,
 sourceSha:HEAD,baseSha:BASE,prNumber:PR});}
test('full pre-review CI/files do not authorize absent final model, role or dissent evidence',()=>{
 assert.equal(preflight,0.9);
 for(const mutate of [
  f=>{delete f.receipt.modelReview.results.Sentinel;},
  f=>{f.receipt.modelReview.results.Builder.source='deterministic-fallback';},
  f=>{f.receipt.modelReview.results.Skeptic.disagreements=['unresolved']},
  f=>{f.receipt.publication.members[0].evidenceRefs=[];},
  f=>{f.receipt.publication.members[0].dissentTags=['security'];},
  f=>{f.report.sourceSha='c'.repeat(40);},
  f=>{f.report.memberAssessments[0].identity.role='unauthenticated'}
 ]){
  const f=completeFacts();mutate(f);
  assert.equal(acceptance(f).status,'held',
   'preflight coverage cannot replace a protected 7/7 acceptance verdict');
 }
});
test('shared-controller role signature never supplies independent identity or author approval',()=>{
 const seed='ab'.repeat(32),keys=deriveCouncilRolePublicKeys(seed);
 const signed=signCouncilRoleVerdict({role:'Sentinel',prNumber:PR,sourceSha:HEAD,
  verdict:'hold',confidence:0.8,source:'model',inputDigest:'c'.repeat(64),
  rationale:'requires material SQL review',findings:['missing proof']},seed);
 assert.equal(verifyCouncilRoleVerdict(signed,
  {trustedPublicKeys:keys,expectedSha:HEAD,expectedPr:PR}),true);
 assert.equal(signed.attestation.independentGithubReview,false);
 assert.equal(verifyCouncilRoleVerdict(signed,
  {trustedPublicKeys:keys,expectedSha:'d'.repeat(40),expectedPr:PR}),false);
});
