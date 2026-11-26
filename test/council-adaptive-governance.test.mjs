import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAdaptiveRisk,evaluateAdaptiveShadow} from '../src/council-adaptive-governance.mjs';
const H='a'.repeat(40),B='b'.repeat(40),P=123;
const roles=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
function facts(path='src/format-number.mjs',votes=6){
 const pr={number:P,state:'open',head:{sha:H,repo},base:{sha:B,ref:'main',repo}};
 const report={isPr:true,itemNumber:P,sourceSha:H,hold:votes<7,memberAssessments:roles.map((role,i)=>({identity:{role},verdict:i<votes?'proceed':'abstain'}))};
 const receipt={decision:votes===7?'proceed':'hold',publication:{members:roles.map((role,i)=>({roleId:'ultron-'+role.toLowerCase(),conclusion:i<votes?'proceed':'abstain',unknowns:[],dissentTags:[],evidenceRefs:['case:exact-head']}))},modelReview:{results:Object.fromEntries(['Builder','Skeptic','Sentinel'].map(role=>[role,{source:'model',modelInvoked:true,verdict:'proceed',disagreements:[],findings:[]}]))}};
 return {pr,files:[{filename:path}],filesComplete:true,report,receipt,
 ci:{pr,comparison:{status:'ahead',behind_by:0},checkRuns:{total_count:4,check_runs:['test','fixed-comparison','reef-runtime-probe','attested-receipt'].map(name=>({name,head_sha:H,app:{id:15368},status:'completed',conclusion:'success',started_at:'2026-11-26T12:00:00Z'}))}},
 roleVerification:{schema:'ultron.council-role-attestation-verification.v1',verified:true,rolesVerified:7,sourceSha:H,authority:'shared-council-controller'},
 taint:{schema:'ultron.council-taint-evidence.v1',sourceSha:H,prNumber:P,complete:true,candidateFiles:1,scannedFiles:1,reports:[{file:path,status:'no-known-flow',findings:[],unknownCount:0}]},
 legacy:{sourceSha:H,baseSha:B,prNumber:P,status:'held',reason:'council-not-unanimous',approvedCount:votes,holdRoles:roles.slice(votes),modelHoldRoles:[]}};
}
test('classifies only bounded routine paths; critical names and renames take precedence',()=>{
 for(const [filename,tier] of [['docs/note.md',0],['cloud/hatchable/public/style.css',1],['src/format-number.mjs',2],['cloud/hatchable/migrations/0001_table.sql',3],['cloud/hatchable/lib/release-proof.js',4],['cloud/hatchable/public/standing-policy.js',4],['src/council-adaptive-governance.mjs',4],['.github/workflows/verify.yml',4],['unknown/path',3]]){
  assert.equal(classifyAdaptiveRisk({files:[{filename}],filesComplete:true}).tier,tier,filename);
 }
 assert.equal(classifyAdaptiveRisk({files:[{filename:'docs/note.md',previous_filename:'src/council-trusted-gate.mjs'}],filesComplete:true}).tier,4);
 assert.equal(classifyAdaptiveRisk({files:[{filename:'docs/note.md'}],filesComplete:false}).tier,4);
});
test('standard six approvals and a documented abstention are shadow-eligible, not merge permission',()=>{
 const r=evaluateAdaptiveShadow(facts());
 assert.equal(r.decision,'eligible');assert.equal(r.requiredCount,6);assert.equal(r.approvedCount,6);assert.equal(r.authorizesMerge,false);
});
test('tier-specific quorum, with no manufactured approval',()=>{
 for(const [path,votes,expected] of [['docs/note.md',4,'eligible'],['cloud/hatchable/public/style.css',5,'eligible'],['src/format-number.mjs',5,'held'],['cloud/hatchable/migrations/0001_table.sql',6,'held'],['cloud/hatchable/lib/release-proof.js',7,'held']]){
  const f=facts(path,votes);if(!path.endsWith('.mjs')&&!path.endsWith('.js'))f.taint={...f.taint,candidateFiles:0,scannedFiles:0,reports:[]};
  assert.equal(evaluateAdaptiveShadow(f).decision,expected,path);
 }
});
test('unclassified dissent, unresolved unknowns and security findings never get outvoted',()=>{
 for(const mutate of [f=>{f.report.memberAssessments[6].verdict='hold';f.receipt.publication.members[6].conclusion='hold';},f=>f.receipt.publication.members[6].unknowns.push('unresolved'),f=>f.receipt.publication.members[6].dissentTags.push('security'),f=>f.receipt.modelReview.results.Skeptic.verdict='hold',f=>f.taint.reports[0].findings.push({kind:'taint-flow'}),f=>f.taint.reports[0].unknownCount=1]){
  const f=facts();mutate(f);assert.equal(evaluateAdaptiveShadow(f).decision,'held');
 }
});
test('explicit provider outage is separate from affirmative model evidence; missing evidence fails closed',()=>{
 const f=facts();f.receipt.modelReview.results.Sentinel={source:'deterministic-fallback',modelInvoked:false,fallbackReason:'free-tier-exhausted-or-failed',verdict:'hold',disagreements:[]};
 const r=evaluateAdaptiveShadow(f);assert.equal(r.decision,'eligible');assert.deepEqual(r.unavailableModels,['Sentinel']);
 for(const mutate of [x=>delete x.receipt.modelReview.results.Sentinel,x=>x.roleVerification.verified=false,x=>x.ci.checkRuns.check_runs[0].conclusion='skipped',x=>x.ci.pr.base.sha='c'.repeat(40),x=>x.taint.complete=false,x=>x.report.memberAssessments.pop(),x=>x.receipt.publication.members[0].evidenceRefs=[]]){
  const b=facts();mutate(b);assert.equal(evaluateAdaptiveShadow(b).decision,'held');
 }
});
