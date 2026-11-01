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
