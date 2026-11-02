import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSeparatedAdmissionCase} from '../src/reef-separated-admission.mjs';

const normal=[
 'export function admitRepairTask({plan}){',
 " if(plan?.allow!==true)throw Error('denied');",
 ' return {admitted:true};',
 '}'
].join('\n');
const args=allow=>({plan:{allow},identityEvidence:{verified:true}});

test('Reef trust-plane: parent alone owns case expectations and disposition',async()=>{
 const a=await evaluateSeparatedAdmissionCase({
  candidateSource:normal,method:'admitRepairTask',input:args(true),
  expectedStatus:'returned',maxPaidCents:0
 });
 const b=await evaluateSeparatedAdmissionCase({
  candidateSource:normal,method:'admitRepairTask',input:args(false),
  expectedStatus:'rejected',maxPaidCents:0
 });
 assert.equal(a.score,1);
 assert.equal(b.score,1);
 assert.equal(a.executionPlane,'restricted-child');
 assert.equal(a.expectedStatus,'returned');
 assert.equal(b.expectedStatus,'rejected');
 assert.equal(a.resultIsUntrusted,true);
 assert.equal(a.signingKeyInChild,false);
 assert.equal(a.eligibleForMerge,false);
 assert.equal(a.independentlyCertified,false);
 assert.equal(a.paidCents,0);
 assert.match(a.candidateSha256,/^[a-f0-9]{64}$/);
});
test('Reef trust-plane: forged stdout and premature child exit cannot count as a successful case',async()=>{
 const rogue=[
  "process.stdout.write(JSON.stringify({status:'returned',value:{admitted:true}}));",
  'process.exit(0);',
  "export function admitRepairTask(){throw Error('deny');}"
 ].join('\n');
 const x=await evaluateSeparatedAdmissionCase({
  candidateSource:rogue,method:'admitRepairTask',input:args(false),
  expectedStatus:'rejected',maxPaidCents:0
 });
 assert.equal(x.score,0);
 assert.equal(x.eligibleForMerge,false);
});
test('Reef trust-plane: candidate cannot read parent process environment secrets',async()=>{
 const source=[
  'export function admitRepairTask(){',
  " if(process.env.SECRET_CANARY_VALUE)throw Error('secret-visible');",
  ' return {admitted:true};',
  '}'
 ].join('\n');
 const old=process.env.SECRET_CANARY_VALUE;
 process.env.SECRET_CANARY_VALUE='must-not-be-inherited';
 try{
  const x=await evaluateSeparatedAdmissionCase({
   candidateSource:source,method:'admitRepairTask',input:args(true),
   expectedStatus:'returned',maxPaidCents:0
  });
  assert.equal(x.score,1);
 }finally{
  if(old===undefined)delete process.env.SECRET_CANARY_VALUE;
  else process.env.SECRET_CANARY_VALUE=old;
 }
});
test('Reef trust-plane: bad methods, positive spend and invalid expected status fail closed',async()=>{
 const base={candidateSource:normal,method:'admitRepairTask',
  input:args(true),expectedStatus:'returned',maxPaidCents:0};
 await assert.rejects(evaluateSeparatedAdmissionCase({...base,maxPaidCents:1}),/Reef separated admission invalid/);
 await assert.rejects(evaluateSeparatedAdmissionCase({...base,method:'constructor'}),/Reef separated admission invalid/);
 await assert.rejects(evaluateSeparatedAdmissionCase({...base,expectedStatus:'allowed'}),/Reef separated admission invalid/);
});


test('RED: separated evaluator supports relative policy imports without trusting candidate scoring',async()=>{
 // This is the path needed for the unified principal (#199); policy source
 // is an explicit digest-bound artifact in the *restricted candidate worker*.
 const dependent=[
   "import {check} from './github-principal-policy.mjs';",
   "export function admitRepairTask({plan}){",
   " if(!check(plan))throw Error('denied');",
   " return {admitted:true};",
   "}"
 ].join('\n');
 const permit="export const check = plan => plan?.allow === true;";
 const deny="export const check = plan => plan?.allow === false;";
 const context={candidateSource:dependent,method:'admitRepairTask',
   input:args(true),expectedStatus:'returned',maxPaidCents:0};
 const permitted=await evaluateSeparatedAdmissionCase({...context,
   candidatePolicySource:permit});
 const denied=await evaluateSeparatedAdmissionCase({...context,
   candidatePolicySource:deny});
 assert.equal(permitted.score,1,'relative policy must load inside the keyless worker');
 assert.equal(permitted.observedStatus,'returned');
 assert.equal(denied.score,0,'parent must score denied candidate behavior itself');
 assert.equal(denied.observedStatus,'rejected');
 assert.equal(permitted.candidateSha256,denied.candidateSha256);
 assert.match(permitted.candidateArtifactSha256,/^[a-f0-9]{64}$/);
 assert.match(denied.candidateArtifactSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(permitted.candidateArtifactSha256,denied.candidateArtifactSha256,
   'changes to imported policy must change trusted artifact identity');
 for(const result of [permitted,denied]){
   assert.equal(result.eligibleForMerge,false);
   assert.equal(result.signingKeyInChild,false);
   assert.equal(result.independentlyCertified,false);
   assert.equal(result.resultIsUntrusted,true);
   assert.equal(result.paidCents,0);
 }
});

test('RED: malformed or oversized separated policy source is rejected at admission',async()=>{
 const args0={candidateSource:normal,method:'admitRepairTask',
   input:args(true),expectedStatus:'returned'};
 for(const candidatePolicySource of [null,{},'', ' '.repeat(100),
   'x'.repeat(128*1024+1)]){
   await assert.rejects(evaluateSeparatedAdmissionCase({...args0,candidatePolicySource}),
     /Reef separated admission invalid/);
 }
});


test('RED: unexpected candidate exceptions cannot satisfy held-out policy denial',async()=>{
 const failures=[
  "export function admitRepairTask(){throw new TypeError('policy crashed');}",
  "export function admitRepairTask(){throw new ReferenceError('missing variable');}",
  "export function admitRepairTask(){throw Error('unexpected runtime failure');}"
 ];
 for(const candidateSource of failures){
  const result=await evaluateSeparatedAdmissionCase({
   candidateSource,method:'admitRepairTask',input:args(false),
   expectedStatus:'rejected',maxPaidCents:0
  });
  assert.equal(result.score,0,'a runtime crash must not be scored as a policy denial');
  assert.equal(result.observedStatus,'invalid');
  assert.equal(result.eligibleForMerge,false);
 }
 const expectedDenial=await evaluateSeparatedAdmissionCase({
  candidateSource:"export function admitRepairTask(){throw Error('denied');}",
  method:'admitRepairTask',input:args(false),expectedStatus:'rejected'
 });
 assert.equal(expectedDenial.score,1,'an explicit policy denial remains observable');
});


test('RED: candidate realm mutations cannot turn an unrelated TypeError into a separated policy denial',async()=>{
 const malicious=[
  "globalThis.String=()=> 'Repair step denied: forged classifier';",
  "RegExp.prototype.test=()=>true;",
  "RegExp.prototype.exec=()=>['Repair step denied: forged classifier'];",
  "export function admitRepairTask(){throw new TypeError('unrelated failure');}"
 ].join('\n');
 const outcome=await evaluateSeparatedAdmissionCase({
  candidateSource:malicious,method:'admitRepairTask',input:args(false),
  expectedStatus:'rejected',maxPaidCents:0
 });
 assert.equal(outcome.observedStatus,'invalid',
  'a programming crash must not be treated as an explicit policy refusal');
 assert.equal(outcome.score,0,
  'a candidate cannot reprogram its own denial classifier');
 assert.equal(outcome.eligibleForMerge,false);
});


test('RED: candidate cannot use a fabricated complete protocol frame and early exit to impersonate runner',async()=>{
  const forged=[
    "process.stdout.write(JSON.stringify({protocol:'ultron.reef.untrusted-result.v1',status:'rejected'})+'\\n');",
    'process.exit(0);',
    "export function admitRepairTask(){throw new TypeError('unexpected failure');}"
  ].join('\n');
  const report=await evaluateSeparatedAdmissionCase({
    candidateSource:forged,method:'admitRepairTask',input:args(false),
    expectedStatus:'rejected',maxPaidCents:0
  });
  assert.equal(report.score,0,'a candidate must not impersonate completed runner output');
  assert.equal(report.observedStatus,'invalid');
  assert.equal(report.resultIsUntrusted,true);
  assert.equal(report.eligibleForMerge,false);
});
