/**
 * Deterministic multi-turn inter-self dialogue transcripts.
 * Advisory only — no model invocations, no execution authority.
 * Turns are derived from fixed role scripts + plan/decision context.
 */
import { createHash } from 'node:crypto';

const ROSTER = Object.freeze([
  { id: 'ultron-builder', name: 'Builder' },
  { id: 'ultron-skeptic', name: 'Skeptic' },
  { id: 'ultron-steward', name: 'Steward' },
  { id: 'ultron-predictor', name: 'Predictor' },
  { id: 'ultron-generator', name: 'Generator' },
  { id: 'ultron-sentinel', name: 'Sentinel' },
  { id: 'ultron-companion', name: 'Companion' },
]);

const MAX_TURNS = 12;
const MAX_OBJECTIVE = 200;

function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function speakerLine(name, text) {
  return Object.freeze({ speaker: name, text: clip(text, 320) });
}

/**
 * Build a multi-turn transcript for an active deliberation or standby.
 */
export function buildInterSelfDialogue(input = {}) {
  const objective = clip(input.objective || 'unspecified objective', MAX_OBJECTIVE);
  const decision = input.decision === 'proceed' || input.decision === 'hold'
    ? input.decision : 'hold';
  const mode = input.mode === 'standby' ? 'standby' : 'active';
  const dissent = Array.isArray(input.dissent)
    ? input.dissent.map(x => clip(x, 80)).filter(Boolean).slice(0, 6)
    : [];
  const observedAt = typeof input.observedAt === 'string' && input.observedAt
    ? input.observedAt
    : new Date().toISOString();

  const turns = [];

  if (mode === 'standby') {
    turns.push(speakerLine('Companion', 'Owner is silent. Holding standby posture and waiting for the next objective.'));
    turns.push(speakerLine('Sentinel', 'Heartbeat nominal. No anomaly on the idle lane. Continue advisory watch.'));
    turns.push(speakerLine('Predictor', 'Rehearsing likely next owner asks without executing tools or spending credits.'));
    turns.push(speakerLine('Steward', 'Authority remains advisory-only. No capability expansion while idle.'));
    turns.push(speakerLine('Builder', 'Ready to propose the smallest allowlisted path when an objective arrives.'));
    turns.push(speakerLine('Skeptic', 'Idle cross-talk must not invent urgency. Hold until owner speech.'));
    turns.push(speakerLine('Generator', 'Caching option sketches within the allowlist for fast activation.'));
    turns.push(speakerLine('Companion', 'Standing by. When the owner speaks, full council activates.'));
  } else {
    turns.push(speakerLine('Companion', `Owner objective received: "${objective}". Opening multi-self floor.`));
    turns.push(speakerLine('Builder', `Propose smallest read-only path under current capabilities for: ${objective}.`));
    turns.push(speakerLine('Generator', 'Enumerating alternate allowlisted options the Builder may have under-weighted.'));
    turns.push(speakerLine('Predictor', 'Ranking counterfactual outcomes: success path vs hold path vs rollback path.'));
    turns.push(speakerLine('Skeptic', dissent.length
      ? `Material concerns: ${dissent.join('; ')}. Prefer hold until resolved.`
      : 'No high-confidence dissent tags yet. Still demand explicit evidence coverage.'));
    turns.push(speakerLine('Sentinel', 'Checking drift, concurrency, and CI coupling risk before any proceed bias.'));
    turns.push(speakerLine('Steward', decision === 'proceed'
      ? 'Evidence and authority checks clear for advisory proceed. Execution authority unchanged.'
      : 'Holding. Advisory receipt only — no merge, deploy, or capability mint.'));
    turns.push(speakerLine('Builder', decision === 'proceed'
      ? 'Aligning to proceed recommendation with inverse/rollback still available on code paths.'
      : 'Refining the plan under hold; ready to re-enter when unknowns close.'));
    turns.push(speakerLine('Companion', decision === 'proceed'
      ? 'Synthesizing action board for the owner. Council remains advisory.'
      : 'Reporting HOLD to the owner with concrete next checks.'));
  }

  const bounded = turns.slice(0, MAX_TURNS);
  const core = {
    schemaVersion: 1,
    kind: 'ultron-inter-self-dialogue',
    mode,
    objective,
    decision,
    observedAt,
    turnCount: bounded.length,
    roster: ROSTER.map(r => r.name),
    turns: bounded,
    modelInvocations: 0,
    creditCost: 0,
    authority: 'advisory-only',
  };
  return Object.freeze({
    ...core,
    fingerprint: createHash('sha256').update(JSON.stringify(core)).digest('hex'),
    transcript: bounded.map((t, i) => `T${i + 1} ${t.speaker}: ${t.text}`).join('\n'),
  });
}

export function formatDialogueMarkdown(dialogue) {
  if (!dialogue?.turns?.length) return '_No inter-self dialogue._';
  const lines = [
    `### Inter-self dialogue (${dialogue.mode}, ${dialogue.turnCount} turns)`,
    '',
    '```',
    dialogue.transcript,
    '```',
    '',
    `Fingerprint: \`${dialogue.fingerprint}\` · modelInvocations: 0 · advisory-only`,
  ];
  return lines.join('\n');
}
