#!/usr/bin/env node
/**
 * Ultron Council — owner-first deterministic debate + action plan.
 * Zero live model calls. Advisory authority only (no merge/deploy).
 *
 * Env:
 *   TITLE, BODY, ITEM_NUMBER, IS_PR
 *   OWNER_MODE=1 / ULTRON_AUTONOMY=1 / ULTRON_VELOCITY=1
 */
import { writeFileSync } from 'node:fs';
import { deliberatePlan } from '../src/grokbot-governor.mjs';
import { ownerAutonomyEnabled, autonomyLimits } from '../src/owner-autonomy.mjs';

const ownerMode = ownerAutonomyEnabled();
const limits = autonomyLimits();
const MAX_BODY = limits.maxBodyChars;
const title = String(process.env.TITLE || 'untitled').slice(0, 240);
const body = String(process.env.BODY || '').slice(0, MAX_BODY);
const item = String(process.env.ITEM_NUMBER || '0');
const isPr = process.env.IS_PR === 'true';
const observedAt = new Date().toISOString();

const lower = `${title}\n${body}`.toLowerCase();
const flags = {
  security: ['secret', 'credential', 'token', 'password', 'bypass security', 'fail-open', 'delete main', 'force push'].some(k => lower.includes(k)),
  autonomy: ['autonomy', 'always-on', 'unattended', 'self-merge', 'auto-merge'].some(k => lower.includes(k)),
  multiFile: ['multi-file', 'multifile', 'across the codebase', 'refactor'].some(k => lower.includes(k)),
  infra: ['workflow', 'github actions', 'ci', 'deploy'].some(k => lower.includes(k)),
};

const large = body.length > 2000;
let evidenceCoverage = flags.security ? 0.35 : large ? 0.65 : 0.9;
let calibratedConfidence = flags.security ? 0.3 : 0.85;
let knownUnknowns = [];
let materialConflictCount = 0;
if (flags.security) {
  knownUnknowns.push('security-sensitive-language');
  materialConflictCount += 1;
}
if (flags.autonomy && !ownerMode) {
  knownUnknowns.push('autonomy-expansion-needs-owner');
  materialConflictCount += 1;
  evidenceCoverage = Math.min(evidenceCoverage, 0.55);
}
if (ownerMode && !flags.security) {
  evidenceCoverage = Math.max(evidenceCoverage, limits.governorMinEvidence);
  calibratedConfidence = Math.max(calibratedConfidence, limits.governorMinConfidence);
  knownUnknowns = knownUnknowns.filter(u => u !== 'autonomy-expansion-needs-owner');
}

const plan = {
  objective: title.slice(0, 200),
  strategy: 'routing-v2',
  status: 'ready',
  steps: [
    { index: 0, command: '/repo inspect', kind: 'read-only', status: 'ready' },
  ],
  executable: true,
  mode: 'read-only',
  autonomous: false,
};

const receipt = deliberatePlan(plan, {
  evidenceCoverage,
  calibratedConfidence,
  knownUnknowns,
  materialConflictCount,
  observedAt,
});

const hold = receipt.decision !== 'proceed' || flags.security;
const status = hold
  ? 'HOLD — OWNER REVIEW REQUIRED'
  : ownerMode
    ? 'OWNER-READY — PROCEED WITH CONSTRAINTS'
    : 'APPROVED WITH CONSTRAINTS';

const selves = (receipt.participants || []).map((p) => {
  const name = p.displayName || p.role || p.id || 'self';
  const stance = p.stance || p.conclusion || p.summary || 'noted';
  return `- **${name}**: ${String(stance).slice(0, 240)}`;
}).join('\n') || '- (see receipt)';

const actions = [];
if (isPr) {
  actions.push('Review exact-head Verify on this PR before merge.');
  actions.push('If Verify is green and scope matches intent, squash-merge when ready.');
}
actions.push('Reply with `@ultron implement …` or open a labeled `feature` follow-up if code work is required.');
if (flags.multiFile) {
  actions.push(`Prefer implement-files with up to ${limits.maxFiles} paths under owner autonomy.`);
}
if (flags.infra) {
  actions.push('Keep workflow actions SHA-pinned; do not float major tags.');
}
if (flags.security) {
  actions.push('Strip secrets/credentials from the proposal body; re-run council after sanitizing.');
}
if (ownerMode) {
  actions.push('Owner autonomy active: council prioritizes execution planning over gatekeeping.');
}
actions.push('Promote durable outcomes into docs/council_precedents.md via a reviewed PR (workflow does not push main).');

const stage1 = `# Stage 1 — Architect framing
**Target:** #${item} — ${title}
**Kind:** ${isPr ? 'pull_request' : 'issue'} · **Owner mode:** ${ownerMode ? 'yes' : 'no'} · **Policy:** ${limits.mode}

## Proposal (bounded)
${body || '(empty body)'}

## System framing
- Deterministic GrokBot council (advisory-only)
- modelInvocations=0 · creditCost=0
- Flags: ${Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
`;

const stage2 = `# Stage 2 — Crucible (Red Team + Pragmatist)

### Red Team
1. Concurrent runs must not race-write institutional memory on main.
2. Bodies capped at ${MAX_BODY} characters.
3. No automatic push to protected main from this workflow.
${flags.security ? '4. Security-sensitive language detected — mandatory owner review.' : ''}
${flags.autonomy ? '5. Autonomy-expansion language present — confirm owner intent.' : ''}

### Pragmatist
1. Prefer label-gated or owner-triggered runs to control CI cost.
2. Keep reports bounded; full receipt is an artifact.
3. Decision is advisory — does not merge, deploy, or widen capability registry by itself.
`;

const stage3 = `# Stage 3 — Architect rebuttal / refinement
1. Memory updates stay comment + artifact; owner promotes precedents in a reviewed PR.
2. Owner autonomy lowers friction for planning without removing syntax/CI floors on code paths.
3. Security holds always win over velocity.
`;

const stage4 = `# Ultron Council Report

**Target:** #${item} — ${title}  
**Status:** **${status}**  
**Observed:** ${observedAt}  
**Fingerprint:** \`${receipt.fingerprint}\`  
**Governor decision:** \`${receipt.decision}\`

### Summary
**Ultron works for the owner, not the other way around.**  
Owner-first deterministic deliberation with action board. Authority remains advisory.

### Selves
${selves}

### Action board (for owner)
${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

### Directives
- [x] Comment-only feedback (no main push)
- [x] Body truncated to ${MAX_BODY} chars
- [${ownerMode ? 'x' : ' '}] Owner autonomy (${limits.mode})
- [${flags.security ? 'x' : ' '}] Security hold
- [${hold ? 'x' : ' '}] Block auto-proceed

---
*Ultron Council · deterministic GrokBot · owner-autonomy doctrine*
`;

writeFileSync('RFC_DRAFT.md', stage1);
writeFileSync('CRITIQUE_MATRIX.md', stage2 + '\n' + stage3);
writeFileSync('FINAL_SYNTHESIS.md', stage4);
writeFileSync('council-receipt.json', JSON.stringify({
  ...receipt,
  ownerMode,
  limits,
  flags,
  status,
  actions,
}, null, 2));

console.log(status);
console.log('fingerprint', receipt.fingerprint);
console.log('ownerMode', ownerMode);
console.log('policy', limits.mode);
console.log('actions', actions.length);
