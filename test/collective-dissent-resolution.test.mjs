import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCollectiveDissent } from '../src/collective-dissent-resolution.mjs';

test('empty material dissent yields resolution receipt', () => {
  const result = resolveCollectiveDissent({
    positions: [{
      individualId: 'ultron-builder',
      conclusion: 'proceed',
      confidence: 0.9,
      evidenceRefs: ['plan:sha256:abc'],
      assumptions: [],
      unknowns: [],
      dissentTags: [],
    }],
    materialDissent: [],
    evidenceLedger: [],
    dissentHistory: [],
  });
  assert.equal(result.kind, 'collective-dissent-resolution');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.materialDissentCount, 0);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('material dissent without ledger evidence is unclassified as unverified', () => {
  const result = resolveCollectiveDissent({
    positions: [{
      individualId: 'ultron-skeptic',
      conclusion: 'hold',
      confidence: 0.85,
      evidenceRefs: ['plan:sha256:abc'],
      assumptions: [],
      unknowns: ['gap'],
      dissentTags: ['evidence-gap'],
    }],
    materialDissent: [{
      individualId: 'ultron-skeptic',
      conclusion: 'hold',
      dissentTags: ['evidence-gap'],
    }],
    evidenceLedger: [],
    dissentHistory: [],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'evidence-unverified');
});
