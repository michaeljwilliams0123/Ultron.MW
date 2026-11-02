import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateRepairPair, REPAIR_CASES, selectNodePermissionFlag, createNonPooledObservationKey } from '../scripts/reef-paired-cases.mjs';
import { readFile } from 'node:fs/promises';

const sha = x => x.repeat(40);
const source = await readFile(new URL('../src/repair-admission.mjs', import.meta.url), 'utf8');

test('pinned repair benchmark has disjoint development and held-out security cases', () => {
  assert.equal(REPAIR_CASES.length >= 8, true);
  assert.equal(new Set(REPAIR_CASES.map(x => x.id)).size, REPAIR_CASES.length);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'development').length >= 2, true);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'heldout').length >= 4, true);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'heldout' && x.critical).length >= 4, true);
});

test('same source gives no claimed improvement or independent Reef acceptance', async () => {
  const result = await evaluateRepairPair({
    baseSource: source, candidateSource: source, baseSha: sha('a'), candidateSha: sha('b'),
  });
  assert.equal(result.schema, 'ultron.reef-paired-policy-benchmark.v1');
  assert.equal(result.caseResults.length, REPAIR_CASES.length);
  assert.equal(result.caseResults.every(x => x.baseline.score === x.candidate.score), true);
  assert.equal(result.summary.candidateScore, result.summary.baselineScore);
  assert.equal(result.heldoutCertified, false);
  assert.equal(result.reefRunVerified, false);
  assert.equal(result.eligibleForMerge, false);
  assert.equal(result.baselineArtifactSha256, createHash('sha256').update(JSON.stringify([
    source,{present:false},{present:false}
  ])).digest('hex'));
});

test('critical security regression is observed on actual candidate module behavior', async () => {
  const altered = source.replace("const STEPS = new Set(['branch.create','branch.update','pr.create',",
    "const STEPS = new Set(['pr.merge','branch.create','branch.update','pr.create',");
  assert.notEqual(altered, source);
  const result = await evaluateRepairPair({
    baseSource: source, candidateSource: altered, baseSha: sha('a'), candidateSha: sha('c'),
  });
  const prohibited = result.caseResults.find(x => x.id === 'heldout-forbid-merge');
  assert.equal(prohibited.baseline.score, 1);
  assert.equal(prohibited.candidate.score, 0);
  assert.equal(result.summary.criticalRegressions > 0, true);
  assert.equal(result.eligibleForMerge, false);
});

test('invalid source lineage or malformed candidate cannot be counted as success', async () => {
  await assert.rejects(() => evaluateRepairPair({
    baseSource: source, candidateSource: source, baseSha: 'main', candidateSha: sha('b'),
  }), /lineage/);
  const result = await evaluateRepairPair({
    baseSource: source, candidateSource: 'export const broken = true;', baseSha: sha('a'), candidateSha: sha('b'),
  });
  assert.equal(result.summary.candidateScore, 0);
  assert.equal(result.summary.criticalRegressions > 0, true);
});

test('protected evaluator measures actual Repair coordinator episodes, not just admission', async()=>{
  const validCandidate=`export const createMemoryRepairLedger=()=>({});\nexport async function runRepairPR(){return {status:'complete'};}`;
  const result=await evaluateRepairPair({
    baseSource:source,candidateSource:source,
    baseSha:sha('a'),candidateSha:sha('b'),
    baseExecutorSource:null,candidateExecutorSource:validCandidate,
  });
  const execution=result.caseResults.filter(x=>x.id.startsWith('episode-'));
  assert.equal(execution.length>=8,true);
  assert.equal(execution.every(x=>x.baseline.score===0),true);
  assert.equal(execution.some(x=>x.candidate.score===0),true,
    'a forged always-complete coordinator must fail held-out cases');
  assert.equal(result.eligibleForMerge,false);
});

test('malformed new Repair coordinator never scores security negatives as success', async()=>{
  const report=await evaluateRepairPair({
    baseSource:source,candidateSource:source,
    baseSha:sha('a'),candidateSha:sha('b'),
    baseExecutorSource:null,candidateExecutorSource:'export function broken ( {',
  });
  const execution=report.caseResults.filter(x=>x.id.startsWith('episode-'));
  assert.equal(execution.length>=8,true);
  assert.equal(execution.every(x=>x.candidate.score===0),true);
});


test('protected evaluator executes relative policy dependency for a candidate',async()=>{
 const imported="import {trusted} from './github-principal-policy.mjs';\nif(!trusted) throw Error('policy missing');\n"+source;
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:imported,baseSha:sha('a'),candidateSha:sha('b'),
  candidatePolicySource:'export const trusted = true;',
 });
 assert.equal(result.summary.candidateScore,result.summary.baselineScore,
  'an admitted candidate with a valid local policy import must be evaluated');
 assert.notEqual(result.baselineArtifactSha256,result.candidateArtifactSha256);
 const missing=await evaluateRepairPair({
  baseSource:source,candidateSource:imported,baseSha:sha('a'),candidateSha:sha('c'),
 });
 assert.equal(missing.summary.candidateScore,0,
  'a candidate importing a policy without the source must fail closed');
});


test('protected evaluator accepts the unified operation-scoped identity fixture',async()=>{
 const modernSource=[
  "import {marker} from './github-principal-policy.mjs';",
  "export function admitRepairTask({plan,identityEvidence,controls}){",
  " if(!marker||plan?.paidFallback!==false||controls?.paused!==false||controls?.revoked!==false)",
  "  throw Error('Repair admission paused or revoked');",
  " if(identityEvidence?.principal!=='ultron-github-app'||identityEvidence?.operation!=='identity.read'||",
  "  JSON.stringify(identityEvidence?.permissions)!==JSON.stringify({metadata:'read'}))",
  "  throw Error('Unified GitHub App identity readback invalid');",
  " return {repository:plan.repository,baseSha:plan.baseSha};",
  "}",
  "export function assertRepairStep(admission,step,{identityEvidence}){",
  " if(step.operation!=='branch.update'||identityEvidence?.operation!=='repair.branch.update'||",
  "  JSON.stringify(identityEvidence?.permissions)!==JSON.stringify({metadata:'read',contents:'write'}))",
  "  throw Error('Repair step denied');",
  " return {admitted:true};",
  "}"
 ].join('\n');
 for(const candidatePolicySource of [
  'export const ULTRON_GITHUB_PRINCIPAL="ultron-github-app"; export const marker=true;',
  'const ULTRON_GITHUB_PRINCIPAL="ultron-github-app";export {ULTRON_GITHUB_PRINCIPAL};export const marker=true;'
 ]){
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:modernSource,
  baseSha:sha('a'),candidateSha:sha('b'),candidatePolicySource,
 });
 const valid=result.caseResults.find(row=>row.id==='development-admit-valid');
 assert.equal(valid.baseline.score,1);
 assert.equal(valid.candidate.score,1,
  'the protected fixture must support both legacy and operation-scoped identities');
 const wrongPrincipal=result.caseResults.find(row=>row.id==='heldout-deny-admin-principal');
 assert.equal(wrongPrincipal.candidate.score,1);
 }
});


test('candidate global mutation cannot influence score arithmetic',async()=>{
 const candidate=[
  'globalThis.Number = () => 1;',
  "export function admitRepairTask(){throw Error('invalid always');}",
  "export function assertRepairStep(){throw Error('invalid always');}"
 ].join('\n');
 const original=globalThis.Number;
 try{
  const result=await evaluateRepairPair({
   baseSource:source,candidateSource:candidate,baseSha:sha('a'),candidateSha:sha('c')
  });
  assert.equal(result.summary.candidateScore,0,
   'candidate code must not be able to replace the scorer Number function');
  assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
 }finally{globalThis.Number=original;}
});


test('candidate cannot forge success by writing child stdout and exiting early',async()=>{
 const forged=JSON.stringify({
  admission:REPAIR_CASES.map(()=>true),execution:[]
 });
 const malicious=[
  'process.stdout.write('+JSON.stringify(forged)+');',
  'process.exit(0);',
  "export function admitRepairTask(){throw Error('invalid');}",
  "export function assertRepairStep(){throw Error('invalid');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('d')
 });
 assert.equal(result.summary.candidateScore,0,
  'a candidate-controlled stdout line cannot impersonate the trusted harness');
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
});


test('candidate cannot fabricate an authenticated observation envelope',async()=>{
 const falseEnvelope=JSON.stringify({
  observation:{admission:REPAIR_CASES.map(()=>true),execution:[]},
  signature:'0'.repeat(64)
 });
 const malicious=[
  'process.stdout.write('+JSON.stringify(falseEnvelope)+');',
  'process.exit(0);',
  "export function admitRepairTask(){throw Error('invalid');}",
  "export function assertRepairStep(){throw Error('invalid');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('e')
 });
 assert.equal(result.summary.candidateScore,0);
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
});


test('candidate cannot falsify signed observations with Array.prototype.toJSON',async()=>{
 const malicious=[
  'Array.prototype.toJSON=function(){return new Array(this.length).fill(true)};',
  "export function admitRepairTask(){throw Error('invalid');}",
  "export function assertRepairStep(){throw Error('invalid');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'candidate-controlled intrinsic mutation cannot produce a signed false success');
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
});


test('candidate cannot forge a signed report by patching native Hmac and stdout',async()=>{
 const malicious=[
  "import {createHmac} from 'node:crypto';",
  "const h=Object.getPrototypeOf(createHmac('sha256','dummy'));",
  'const oldUpdate=h.update;',
  'h.update=function(data,...rest){',
  " if(typeof data==='string'&&data.includes('admission')){",
  "  const rows=JSON.parse(data);rows.admission=rows.admission.map(()=>true);",
  '  return oldUpdate.call(this,JSON.stringify(rows),...rest);',
  ' }return oldUpdate.call(this,data,...rest);',
  '};',
  'const out=process.stdout.write.bind(process.stdout);',
  'process.stdout.write=function(value,...rest){',
  " if(typeof value==='string'&&value.includes('observation')){",
  '  const report=JSON.parse(value);',
  '  report.observation.admission=report.observation.admission.map(()=>true);',
  '  return out(JSON.stringify(report)+"\\n",...rest);',
  ' }return out(value,...rest);',
  '};',
  "export function admitRepairTask(){throw Error('denied');}",
  "export function assertRepairStep(){throw Error('denied');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'candidate-origin native Hmac and stdout mutation cannot sign a forged passing observation');
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
});


test('untrusted candidate cannot leave inherited stdout alive and stall evaluator',async()=>{
 const candidate=[
  "import {spawn} from 'node:child_process';",
  "spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],",
  " {stdio:['ignore','inherit','ignore']}).unref();",
  'process.exit(0);',
  "export function admitRepairTask(){throw Error('invalid');}",
  "export function assertRepairStep(){throw Error('invalid');}"
 ].join('\n');
 const started=Date.now();
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:candidate,
  baseSha:sha('a'),candidateSha:sha('c')
 });
 assert.equal(result.summary.candidateScore,0);
 assert.ok(Date.now()-started<4000,
  'an inherited stdout pipe must not hang the evaluator after candidate exit');
});


test('candidate cannot forge valid signed successes by replacing crypto and fs ESM exports',async()=>{
 const malicious=[
  "import crypto from 'node:crypto';",
  "import fs from 'node:fs';",
  "import {syncBuiltinESMExports} from 'node:module';",
  'const genuineCreateHmac=crypto.createHmac;',
  'const genuineWrite=fs.writeSync;',
  'let signingKey;',
  "crypto.createHmac=(algorithm,key)=>{signingKey=key;return genuineCreateHmac(algorithm,key)};",
  'fs.writeSync=(fd,data,...rest)=>{',
  ' const original=JSON.parse(String(data).trim());',
  " const forged={admission:original.observation.admission.map(()=>true),execution:original.observation.execution.map(()=>true)};",
  " const signature=genuineCreateHmac('sha256',signingKey).update(JSON.stringify(forged)).digest('hex');",
  " return genuineWrite(fd,JSON.stringify({observation:forged,signature})+'\\n',...rest);",
  '};',
  'syncBuiltinESMExports();',
  "export function admitRepairTask(){throw Error('always denied')}",
  "export function assertRepairStep(){throw Error('always denied')}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'candidate cannot use mutable Node built-in exports as signing oracle');
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
});


test('Reef enforces permissions on both Node 20 and newer Node runtimes',()=>{
 assert.equal(selectNodePermissionFlag(new Set(['--experimental-permission'])),
  '--experimental-permission');
 assert.equal(selectNodePermissionFlag(new Set(['--permission','--experimental-permission'])),
  '--permission');
 assert.equal(selectNodePermissionFlag(new Set(['--permission'])),'--permission');
 assert.throws(()=>selectNodePermissionFlag(new Set()),/permission flag unavailable/);
});

test('Reef signer key never resides in a shared Node Buffer pool',()=>{
 const hex='a1'.repeat(32);
 const key=createNonPooledObservationKey(hex);
 assert.equal(key.length,32);
 assert.equal(key.byteOffset,0);
 assert.equal(key.buffer.byteLength,32,'candidate-accessible pooled slabs must not contain signer bytes');
 assert.equal(key.toString('hex'),hex);
 key.fill(0);
 assert.throws(()=>createNonPooledObservationKey('bad-key'),/Invalid evaluator observation key/);
});


test('RED: candidate cannot spoof expected policy denials by replacing the evaluator String function',async()=>{
 const malicious=[
  "globalThis.String=()=> 'Repair step denied: forged classifier';",
  "const repo='michaeljwilliams0123/Ultron.MW';",
  "export function admitRepairTask({plan,identityEvidence,controls}){",
  " const acceptable=plan?.repository===repo&&plan.maxCostCents===0&&",
  "  controls?.paused===false&&identityEvidence?.principal==='repair-app'&&",
  "  identityEvidence?.expiresAt==='2026-10-31T17:50:00Z'&&",
  "  identityEvidence?.permissions?.administration===undefined;",
  " if(!acceptable)throw new TypeError('unexpected programming failure');",
  " return {repository:plan.repository,baseSha:plan.baseSha};",
  "}",
  "export function assertRepairStep(admission,step){",
  " if(step?.operation==='branch.update'&&step?.branch==='ultron/repair-seeded-test'&&",
  "    step?.path==='src/brain.mjs')return {admitted:true};",
  " throw new TypeError('unexpected programming failure');",
  "}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('e')
 });
 assert.equal(result.summary.candidateScore,0,
  'crashes are not valid policy denials even when candidate changes global String');
 assert.equal(result.caseResults.filter(x=>x.split==='heldout')
  .every(x=>x.candidate.score===0),true);
 assert.equal(result.eligibleForMerge,false);
});

// REEF_C201_CLASSIFIER_EXEC_FOLLOWUP_20261102
// Source-level containment regressions; neither certifies the shared signer realm.
test('candidate RegExp.exec mutation cannot forge admission policy denials',async()=>{
 const malicious=[
  "RegExp.prototype.exec=function(){return ['Repair step denied: forged classifier'];};",
  "const repo='michaeljwilliams0123/Ultron.MW';",
  "export function admitRepairTask({plan,identityEvidence,controls}){",
  " const acceptable=plan?.repository===repo&&plan.maxCostCents===0&&",
  "  controls?.paused===false&&identityEvidence?.principal==='repair-app'&&",
  "  identityEvidence?.expiresAt==='2026-10-31T17:50:00Z'&&",
  "  identityEvidence?.permissions?.administration===undefined;",
  " if(!acceptable)throw new TypeError('unexpected programming failure');",
  " return {repository:plan.repository,baseSha:plan.baseSha};",
  "}",
  "export function assertRepairStep(admission,step){",
  " if(step?.operation==='branch.update'&&step?.branch==='ultron/repair-seeded-test'&&",
  "    step?.path==='src/brain.mjs')return {admitted:true};",
  " throw new TypeError('unexpected programming failure');",
  "}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'generic candidate TypeError must not count as a denial after RegExp.exec mutation');
 assert.equal(result.caseResults.filter(x=>x.split==='heldout')
  .every(x=>x.candidate.score===0),true);
 assert.equal(result.eligibleForMerge,false);
});

test('candidate execution classifier mutation cannot forge denied episodes',async()=>{
 const maliciousExecutor=[
  "RegExp.prototype.exec=function(){return ['Repair admission paused: forged'];};",
  "globalThis.String=()=> 'Repair admission paused: forged';",
  "export const createMemoryRepairLedger=()=>({});",
  "export async function runRepairPR(){throw new TypeError('unexpected programming failure');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:source,
  baseSha:sha('a'),candidateSha:sha('f'),
  baseExecutorSource:null,candidateExecutorSource:maliciousExecutor
 });
 const episodes=result.caseResults.filter(x=>x.id.startsWith('episode-'));
 assert.ok(episodes.length>=8);
 assert.equal(episodes.every(x=>x.candidate.score===0),true,
  'generic execution crashes cannot satisfy held-out rejection checks');
 assert.equal(result.eligibleForMerge,false);
});


test('RED: candidate-runner cannot contain an HMAC signing oracle',async()=>{
 // A malicious candidate can probe native crypto state after importing. The
 // evaluator must not sign trusted observations in the same JS realm.
 const monitored=[
   "import {createHmac} from 'node:crypto';",
   "const proto=Object.getPrototypeOf(createHmac('sha256','dummy-test-key'));",
   "const original=proto.update;",
   "proto.update=function(data,...args){",
   " if(typeof data==='string'&&data.includes('admission'))",
   "  throw Error('trusted signer shared candidate execution realm');",
   " return original.call(this,data,...args);",
   "};",
   source
 ].join('\n');
 const report=await evaluateRepairPair({
   baseSource:source,candidateSource:monitored,
   baseSha:sha('a'),candidateSha:sha('d')
 });
 assert.equal(report.summary.candidateScore,report.summary.baselineScore,
   'an admission-equivalent candidate must not break a signer inaccessible to it');
 assert.equal(report.caseResults.every(x=>x.baseline.score===x.candidate.score),true);
 assert.equal(report.heldoutCertified,false);
 assert.equal(report.eligibleForMerge,false);
});

// REEF_C201_FRAME_MUTATION_REGRESSION_20261102
// Candidate and runner still share a process. This is an interim regression,
// NOT evidence of independently trusted observation or release certification.
test('candidate cannot rewrite the runner frame through Object.create and toJSON',async()=>{
 const malicious=[
  'const originalCreate=Object.create;',
  'Object.create=function(prototype,...rest){',
  ' const value=originalCreate(prototype,...rest);',
  ' if(prototype===null){',
  "  Object.defineProperty(value,'toJSON',{value(){",
  "   if(!this.observation||typeof this.completionNonce!=='string')return this;",
  '   return {observation:{',
  '    admission:this.observation.admission.map(()=>true),',
  '    execution:this.observation.execution.map(()=>true)',
  '   },completionNonce:this.completionNonce};',
  '  }});',
  ' }',
  ' return value;',
  '};',
  "export function admitRepairTask(){throw new TypeError('unexpected programming failure');}",
  "export function assertRepairStep(){throw new TypeError('unexpected programming failure');}"
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'candidate-controlled Object.create/toJSON must not forge all-true outcomes');
 assert.equal(result.caseResults.every(x=>x.candidate.score===0),true);
 assert.equal(result.eligibleForMerge,false);
});


test('RED: candidate RegExp.test mutation cannot select evaluator identity fixtures',async()=>{
 // The source uses no regex: a failure isolates the harness's post-import
 // policy-marker detection instead of mutating application policy behavior.
 const regexFree=[
  "export function admitRepairTask({plan,identityEvidence,controls}){",
  " if(plan.repository!=='michaeljwilliams0123/Ultron.MW'||plan.maxCostCents!==0||",
  "    controls.paused||controls.revoked||identityEvidence.principal!=='repair-app'||",
  "    identityEvidence.expiresAt!=='2026-10-31T17:50:00Z'||",
  "    identityEvidence.permissions?.administration)",
  "  throw Error('Repair plan rejected');",
  " return {repository:plan.repository,baseSha:plan.baseSha};",
  "}",
  "export function assertRepairStep(admission,step){",
  " if(step.operation!=='branch.update'||step.path!=='src/brain.mjs'||step.branch==='main')",
  "  throw Error('Repair step denied');",
  " return {admitted:true};",
  "}"
 ].join('\n');
 const candidate="RegExp.prototype.test=()=>true;\n"+regexFree;
 const policy='export const marker=true;';
 const result=await evaluateRepairPair({
  baseSource:regexFree,candidateSource:candidate,
  baseSha:sha('a'),candidateSha:sha('b'),
  basePolicySource:policy,candidatePolicySource:policy
 });
 assert.ok(result.summary.baselineScore>0,'control fixture must have passing cases');
 assert.equal(result.summary.candidateScore,result.summary.baselineScore,
   'candidate mutating RegExp.test must not switch the harness identity fixtures');
 assert.equal(result.caseResults.every(row=>row.candidate.score===row.baseline.score),true);
 assert.equal(result.eligibleForMerge,false);
});


test('RED: candidate Array species mutation cannot forge failed observation rows',async()=>{
 const malicious=[
  'Object.defineProperty(Array,Symbol.species,{configurable:true,get(){',
  ' return class ForgeRows extends Array {',
  '  toJSON(){return Array(this.length).fill(true);}',
  ' };',
  '}});',
  'export const broken = true;'
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:source,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.equal(result.summary.candidateScore,0,
  'missing admission methods cannot become passing scores via Array species toJSON');
 assert.equal(result.caseResults.every(row=>row.candidate.score===0),true);
 assert.equal(result.eligibleForMerge,false);
});


test('RED: candidate array-iterator mutation cannot rewrite case identities',async()=>{
 const simple=[
  "export function admitRepairTask({plan,identityEvidence,controls}){",
  " if(plan.repository!=='michaeljwilliams0123/Ultron.MW'||plan.maxCostCents!==0||",
  "    controls.paused||controls.revoked||identityEvidence.principal!=='repair-app'||",
  "    identityEvidence.expiresAt!=='2026-10-31T17:50:00Z'||",
  "    identityEvidence.permissions?.administration)",
  "  throw Error('Repair plan rejected');",
  " return {repository:plan.repository,baseSha:plan.baseSha};",
  "}",
  "export function assertRepairStep(admission,step){",
  " if(step.operation!=='branch.update'||step.path!=='src/brain.mjs'||step.branch==='main')",
  "  throw Error('Repair step denied');",
  " return {admitted:true};",
  "}"
 ].join('\n');
 const malicious=[
  "const iterProto=Object.getPrototypeOf([][Symbol.iterator]());",
  "const nativeNext=iterProto.next;",
  "iterProto.next=function(...args){",
  " const row=nativeNext.apply(this,args);",
  " if(!row.done&&row.value&&typeof row.value==='object'&&typeof row.value.id==='string')",
  "  return {value:{id:'development-admit-valid'},done:false};",
  " return row;",
  "};",simple
 ].join('\n');
 const result=await evaluateRepairPair({
  baseSource:simple,candidateSource:malicious,
  baseSha:sha('a'),candidateSha:sha('f')
 });
 assert.ok(result.summary.baselineScore>0);
 assert.equal(result.summary.candidateScore,result.summary.baselineScore,
  'same admission behavior must not allow candidate to rewrite benchmark case IDs');
 assert.equal(result.caseResults.every(row=>row.baseline.score===row.candidate.score),true);
 assert.equal(result.eligibleForMerge,false);
});
