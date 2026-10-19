import test from 'node:test';
import assert from 'node:assert/strict';

import { assessMetacognition } from '../src/metacognition.mjs';

test('metacognition holds when evidence coverage is low or material conflict remains', () => {
  const assessment = assessMetacognition({
    evidenceCoverage: 0.45,
    calibratedConfidence: 0.82,
    knownUnknowns: ['production-load'],
    materialConflictCount: 1,
    reversible: true,
  });
  assert.equal(assessment.action, 'hold');
  assert.equal(assessment.knownUnknowns[0], 'production-load');
  assert.equal(assessment.proceed, false);
});

test('metacognition proceeds only when confidence is calibrated and evidence is sufficient', () => {
  const assessment = assessMetacognition({
    evidenceCoverage: 0.94,
    calibratedConfidence: 0.83,
    knownUnknowns: [],
    materialConflictCount: 0,
    reversible: true,
  });
  assert.equal(assessment.action, 'proceed');
  assert.equal(assessment.proceed, true);
  assert.equal(assessment.calibrationGap <= 0.15, true);
});

test('overconfident low-evidence state seeks evidence instead of proceeding', () => {
  const assessment = assessMetacognition({
    evidenceCoverage: 0.55,
    calibratedConfidence: 0.96,
    knownUnknowns: [],
    materialConflictCount: 0,
    reversible: true,
  });
  assert.equal(assessment.action, 'seek-evidence');
  assert.equal(assessment.proceed, false);
});

test('standalone metacognition keeps the bounded caller unknown limit', () => {
  assert.throws(() => assessMetacognition({
    evidenceCoverage: 0.95,
    calibratedConfidence: 0.9,
    knownUnknowns: Array.from({ length: 33 }, (_, index) => `caller-unknown-${index}`),
    materialConflictCount: 0,
    reversible: true,
  }), error => error?.code === 'metacognition-invalid');
});
