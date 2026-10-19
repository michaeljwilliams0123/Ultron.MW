import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCognitiveIndividual,
  projectPublicCognitiveProfile,
  validateCognitiveIndividual,
} from '../src/cognitive-individual.mjs';

const NOW = '2026-10-19T18:00:00.000Z';
const input = {
  individualId: 'ultron-skeptic',
  parentAgentId: 'ultron-core',
  displayName: 'Skeptic',
  archetype: 'adversarial-reviewer',
  perspective: 'Seek disconfirming evidence before accepting a collective conclusion.',
  communicationStyle: 'concise-evidence-first',
  traits: { skepticism: 0.95, curiosity: 0.72, creativity: 0.41, patience: 0.8 },
  epistemicPosture: {
    evidenceThreshold: 0.9,
    uncertaintyTolerance: 0.3,
    dissentDisposition: 'surface-material-dissent',
  },
  perspectiveTags: ['adversarial', 'risk', 'verification'],
  privateEpisodicRefs: ['episode:sha256:' + 'a'.repeat(64)],
};

test('cognitive individual preserves stable identity and private autobiography', () => {
  const individual = createCognitiveIndividual(input, { observedAt: NOW });
  assert.equal(individual.individualId, 'ultron-skeptic');
  assert.equal(individual.sharePolicy, 'explicit-promotion-only');
  assert.deepEqual(individual.privateEpisodicRefs, input.privateEpisodicRefs);
  assert.match(individual.fingerprint, /^[a-f0-9]{64}$/);
});

test('public cognitive projection never leaks private episode references', () => {
  const publicProfile = projectPublicCognitiveProfile(
    createCognitiveIndividual(input, { observedAt: NOW }),
  );
  assert.equal(Object.hasOwn(publicProfile, 'privateEpisodicRefs'), false);
  assert.equal(publicProfile.privateMemoryCount, 1);
  assert.equal(JSON.stringify(publicProfile).includes('episode:sha256:'), false);
});

test('personality cannot inject or widen authority', () => {
  const individual = createCognitiveIndividual(input, { observedAt: NOW });
  assert.equal(individual.authoritySource, 'ultron-capability-registry');
  assert.equal(Object.hasOwn(individual, 'privileges'), false);
  assert.throws(() => validateCognitiveIndividual({
    ...individual,
    privileges: ['admin'],
  }), { code: 'cognitive-individual-invalid' });
});

test('trait order does not change cognitive identity fingerprint', () => {
  const first = createCognitiveIndividual(input, { observedAt: NOW });
  const second = createCognitiveIndividual({
    ...input,
    traits: { patience: 0.8, creativity: 0.41, curiosity: 0.72, skepticism: 0.95 },
  }, { observedAt: NOW });
  assert.equal(first.fingerprint, second.fingerprint);
});

test('invalid traits and permissive memory sharing fail closed', () => {
  assert.throws(() => createCognitiveIndividual({
    ...input,
    traits: { skepticism: 1.1 },
  }, { observedAt: NOW }), { code: 'cognitive-individual-traits-invalid' });
  const individual = createCognitiveIndividual(input, { observedAt: NOW });
  assert.throws(() => validateCognitiveIndividual({
    ...individual,
    sharePolicy: 'share-everything',
  }), { code: 'cognitive-individual-invalid' });
});
