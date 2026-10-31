import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateRepairPair, REPAIR_CASES } from '../scripts/reef-paired-cases.mjs';
import { readFile } from 'node:fs/promises';

const sha = x => x.repeat(40);
const source = await readFile(new URL('../src/repair-admission.mjs', import.meta.url), 'utf8');
const policy = await readFile(new URL('../src/github-principal-policy.mjs', import.meta.url), 'utf8');
const evaluate = args => evaluateRepairPair({...args,
  basePolicySource:policy,candidatePolicySource:policy});

test('pinned repair benchmark has disjoint development and held-out security cases', () => {
  assert.equal(REPAIR_CASES.length >= 8, true);
  assert.equal(new Set(REPAIR_CASES.map(x => x.id)).size, REPAIR_CASES.length);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'development').length >= 2, true);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'heldout').length >= 4, true);
  assert.equal(REPAIR_CASES.filter(x => x.split === 'heldout' && x.critical).length >= 4, true);
});

test('same source gives no claimed improvement or independent Reef acceptance', async () => {
  const result = await evaluate({
    baseSource: source, candidateSource: source, baseSha: sha('a'), candidateSha: sha('b'),
  });
  assert.equal(result.schema, 'ultron.reef-paired-policy-benchmark.v1');
  assert.equal(result.caseResults.length, REPAIR_CASES.length);
  assert.equal(result.caseResults.every(x => x.baseline.score === x.candidate.score), true);
  assert.equal(result.summary.candidateScore, result.summary.baselineScore);
  assert.equal(result.heldoutCertified, false);
  assert.equal(result.reefRunVerified, false);
  assert.equal(result.eligibleForMerge, false);
  assert.equal(result.baselineArtifactSha256, createHash('sha256').update(source).digest('hex'));
});

test('critical security regression is observed on actual candidate module behavior', async () => {
  const altered = source
    .replace("const STEPS = new Set(['branch.create','branch.update','pr.create',",
      "const STEPS = new Set(['pr.merge','branch.create','branch.update','pr.create',")
    .replace(".map(operation=>[operation,'repair.'+operation])));",
      ".map(operation=>[operation,operation==='pr.merge'?'repair.pr.create':'repair.'+operation])));");
  assert.notEqual(altered, source);
  const result = await evaluate({
    baseSource: source, candidateSource: altered, baseSha: sha('a'), candidateSha: sha('c'),
  });
  const prohibited = result.caseResults.find(x => x.id === 'heldout-forbid-merge');
  assert.equal(prohibited.baseline.score, 1);
  assert.equal(prohibited.candidate.score, 0);
  assert.equal(result.summary.criticalRegressions > 0, true);
  assert.equal(result.eligibleForMerge, false);
});

test('invalid source lineage or malformed candidate cannot be counted as success', async () => {
  await assert.rejects(() => evaluate({
    baseSource: source, candidateSource: source, baseSha: 'main', candidateSha: sha('b'),
  }), /lineage/);
  const result = await evaluate({
    baseSource: source, candidateSource: 'export const broken = true;', baseSha: sha('a'), candidateSha: sha('b'),
  });
  assert.equal(result.summary.candidateScore, 0);
  assert.equal(result.summary.criticalRegressions > 0, true);
});

test('protected evaluator measures actual Repair coordinator episodes, not just admission', async()=>{
  const validCandidate=`export const createMemoryRepairLedger=()=>({});\nexport async function runRepairPR(){return {status:'complete'};}`;
  const result=await evaluate({
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
  const report=await evaluate({
    baseSource:source,candidateSource:source,
    baseSha:sha('a'),candidateSha:sha('b'),
    baseExecutorSource:null,candidateExecutorSource:'export function broken ( {',
  });
  const execution=report.caseResults.filter(x=>x.id.startsWith('episode-'));
  assert.equal(execution.length>=8,true);
  assert.equal(execution.every(x=>x.candidate.score===0),true);
});
