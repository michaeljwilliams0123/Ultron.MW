import test from 'node:test';
import assert from 'node:assert/strict';

import { createCognitiveIndividual } from '../src/cognitive-individual.mjs';
import {
  createCollectivePosition,
  selectCollectiveParticipants,
  synthesizeCollectiveDeliberation,
} from '../src/collective-cognition.mjs';

const NOW = '2026-10-19T18:30:00.000Z';
function individual(id, tags, traits = { curiosity: 0.7 }) {
  return createCognitiveIndividual({
    individualId: id,
    parentAgentId: 'ultron-core',
    displayName: id,
    archetype: `${id}-archetype`,
    perspective: `Perspective for ${id}`,
    communicationStyle: 'evidence-first',
    traits,
    epistemicPosture: {
      evidenceThreshold: 0.8,
      uncertaintyTolerance: 0.4,
      dissentDisposition: 'surface-material-dissent',
    },
    perspectiveTags: tags,
    privateEpisodicRefs: [],
  }, { observedAt: NOW });
}

const members = [
  individual('skeptic-agent', ['adversarial', 'risk']),
  individual('builder-agent', ['engineering', 'systems']),
  individual('research-agent', ['research', 'evidence']),
];

test('participant selection covers required perspectives without cloning one viewpoint', () => {
  const selected = selectCollectiveParticipants({
    members,
    requiredPerspectiveTags: ['engineering', 'risk', 'evidence'],
    maximumParticipants: 3,
  });
  assert.deepEqual(selected.map(item => item.individualId), [
    'builder-agent', 'research-agent', 'skeptic-agent',
  ]);
  assert.equal(new Set(selected.flatMap(item => item.perspectiveTags)).has('risk'), true);
});

test('collective synthesis preserves material dissent instead of voting it away', () => {
  const positions = [
    createCollectivePosition({ individualId: 'builder-agent', conclusion: 'proceed', confidence: 0.84, evidenceRefs: ['ev:build'], assumptions: ['rollback-ready'], unknowns: [], dissentTags: [] }),
    createCollectivePosition({ individualId: 'research-agent', conclusion: 'proceed', confidence: 0.73, evidenceRefs: ['ev:research'], assumptions: [], unknowns: ['traffic-shape'], dissentTags: [] }),
    createCollectivePosition({ individualId: 'skeptic-agent', conclusion: 'hold', confidence: 0.91, evidenceRefs: ['ev:risk'], assumptions: [], unknowns: [], dissentTags: ['unbounded-state-risk'] }),
  ];
  const result = synthesizeCollectiveDeliberation({ positions });
  assert.equal(result.decision, 'hold');
  assert.equal(result.materialDissent.length, 1);
  assert.equal(result.materialDissent[0].individualId, 'skeptic-agent');
  assert.deepEqual(result.evidenceRefs, ['ev:build', 'ev:research', 'ev:risk']);
});
