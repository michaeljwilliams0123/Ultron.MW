import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateRepairPair, REPAIR_CASES } from '../scripts/reef-paired-cases.mjs';
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
