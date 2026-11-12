#!/usr/bin/env node
/**
 * Ultron Council — owner-first deterministic debate + action plan.
 * Includes multi-turn inter-self dialogue transcripts.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import {buildCouncilPublication} from '../src/council-publication.mjs';
import { deliberatePlan } from '../src/grokbot-governor.mjs';
import { ownerAutonomyEnabled, autonomyLimits } from '../src/owner-autonomy.mjs';
import {assessCouncil} from '../src/council-members.mjs';
import {buildCouncilExactHeadEvidence} from '../src/council-exact-head-evidence.mjs';
import {summarizeCouncilIdentityEvidence} from '../src/council-app-identities.mjs';
import {runReasoningRound} from '../src/council-reasoning.mjs';
import { buildInterSelfDialogue, formatDialogueMarkdown } from '../src/inter-self-dialogue.mjs';

const ownerMode = ownerAutonomyEnabled();
const limits = autonomyLimits();
const MAX_BODY = limits.maxBodyChars;
const title = String(process.env.TITLE || 'untitled').slice(0, 240);
const body = String(process.env.BODY || '').slice(0, MAX_BODY);
const item = String(process.env.ITEM_NUMBER || '0');
const isPr = process.env.IS_PR === 'true';
const sourceSha = process.env.TARGET_SOURCE_SHA || '';
const observedAt = new Date().toISOString();

const lower = `${title}\n${body}`.toLowerCase();
const flags = {
  security: process.env.ORIGINAL_SECURITY_SIGNAL === '1' || ['secret', 'credential', 'token', 'password', 'bypass security', 'fail-open', 'delete main', 'force push'].some(k => lower.includes(k)),
  autonomy: ['autonomy', 'always-on', 'unattended', 'self-merge', 'auto-merge'].some(k => lower.includes(k)),
  multiFile: ['multi-file', 'multifile', 'across the codebase', 'refactor'].some(k => lower.includes(k)),
  infra: /\b(workflow|github actions|ci|deploy)\b/.test(lower),
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

const dialogue = buildInterSelfDialogue({
  mode: 'active',
  objective: title,
  decision: receipt.decision,
  dissent: knownUnknowns,
  observedAt,
});

const publication=buildCouncilPublication({
  title,body,isPr,sourceSha,positions:receipt.positions,
  ownerMode,flags
});
const roleLabels={
  'ultron-builder':'Builder','ultron-skeptic':'Skeptic',
  'ultron-steward':'Steward','ultron-predictor':'Predictor',
  'ultron-generator':'Generator','ultron-sentinel':'Sentinel',
  'ultron-companion':'Companion'
};
const itemNumber=Number(item)||0;
// Caller is trusted main-workflow GitHub REST readback; never PR text.
// Absent, partial or stale evidence remains unverified (no advisory softening).
let reviewEvidence=null;
try{
 const path=process.env.COUNCIL_REVIEW_EVIDENCE_FILE;
 if(path&&isPr){
  const data=JSON.parse(readFileSync(path,'utf8'));
  reviewEvidence=buildCouncilExactHeadEvidence(data);
 }
}catch{reviewEvidence=null;}
const memberAssessments=assessCouncil({
  title,body,isPr,itemNumber,sourceSha,flags,ownerMode,
  reviewEvidence:reviewEvidence?.sourceSha===sourceSha?reviewEvidence:null,
  governorPositions:receipt.positions
});
const icon=v=>v==='proceed'?'✅':'⛔';
const memberTable='| Member | Verdict | Why | Will do |\n|---|---|---|---|\n'+
  memberAssessments.map(m=>'| **'+m.identity.role+'** (`'+m.identity.appSlug+'`) | '+
    icon(m.verdict)+' '+m.verdict+' ('+m.confidence+') | '+
    m.headline+' '+m.reasons.join(' ')+' | '+
    (m.actions.map(a=>'`'+a.op+'`').join(', ')||'—')+' |').join('\n');
const roleAssessments=memberAssessments.map(m=>'- **'+m.identity.role+'** — '+m.mandate+
  '\n'+m.actions.map(a=>'  - `'+a.op+'`: '+a.why).join('\n')).join('\n');
const evidenceDetails=publication.members.map(member=>
  '- `'+member.roleId+'` '+member.conclusion+' '+member.confidence+
  ' · evidence '+(member.evidenceRefs.join(', ')||'none')+
  ' · unknowns '+(member.unknowns.join(', ')||'none')+
  ' · dissent '+(member.dissentTags.join(', ')||'none')).join('\n');
const independentCount=memberAssessments.filter(m=>m.identityState.independent).length;
// Receipts are verified, never trusted: only valid bot-authored receipts for this case count.
let receiptProven=0;
try{
 const f=process.env.COUNCIL_EXECUTION_RECEIPTS_FILE;
 if(f)receiptProven=summarizeCouncilIdentityEvidence(JSON.parse(readFileSync(f,'utf8')),{
  caseSha:process.env.COUNCIL_CASE_SHA,sourceSha:process.env.COUNCIL_SOURCE_SHA
 }).rolesProven;
}catch{receiptProven=0;}
const configuredCount=memberAssessments.filter(m=>m.identityState.configured).length;
const proceedCount=memberAssessments.filter(m=>m.verdict==='proceed').length;

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

const reasoning = await runReasoningRound({ input: `${title}\n\n${body}` });
const reasoningSection = reasoning.modelInvocations > 0
  ? `\n### Model reasoning (advisory, free tier, public input only)\n${Object.entries(reasoning.results).map(([r, v]) => `- **${r}** — ${v.source === 'model' ? `${v.provider}/${v.modelId}` : `deterministic fallback (${v.fallbackReason})`}: ${v.verdict} (${v.confidence}) ${String(v.rationale).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}\n${reasoning.disagreement ? '\n**Disagreement recorded between roles.**\n' : ''}`
  : '';
const modelNote = reasoning.modelInvocations > 0
  ? `${reasoning.modelInvocations} of 3 reasoning roles invoked a real free-tier model (Builder, Skeptic, Sentinel); the seven member votes remain a deterministic screen`
  : 'Council votes are a deterministic screen (modelInvocations=0)';
const stage1 = `# Stage 1 — Architect framing
**Target:** #${item} — ${title}
**Kind:** ${isPr ? 'pull_request' : 'issue'} · **Owner mode:** ${ownerMode ? 'yes' : 'no'} · **Policy:** ${limits.mode}

## Proposal (bounded)
${body || '(empty body)'}

## System framing
- Deterministic GrokBot council (advisory-only)
- Multi-turn inter-self dialogue attached
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
${publication.marker}

**Target:** #${item} — ${title}<br>
**Status:** **${status}** · ${proceedCount}/7 members say proceed<br>
**Observed:** ${observedAt}

### Council verdicts
${memberTable}

**Identities:** \`${configuredCount}/7\` have credential fields configured (not authentication); \`${independentCount}/7\` have independently authenticated authorship proven by this report; \`${receiptProven}/7\` have verified App execution receipts. This report is posted by github-actions, not seven App accounts. App authentication must be established at execution time. ${modelNote}, not independent review.

${reasoningSection}
### What each member will do
${roleAssessments}

### Action board (for owner)
${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

<details><summary>Evidence & receipts</summary>

**Evidence fingerprint:** \`${publication.fingerprint}\`<br>
**Run receipt:** \`${receipt.fingerprint}\`<br>
**Governor decision:** \`${receipt.decision}\`

${evidenceDetails}

${selves}

${formatDialogueMarkdown(dialogue)}

</details>

### Directives
- [${ownerMode ? 'x' : ' '}] Owner autonomy (${limits.mode})
- [${flags.security ? 'x' : ' '}] Security hold
- [${hold ? 'x' : ' '}] Block auto-proceed

---
*Ultron Council · seven identities, seven brains*
`;

writeFileSync('RFC_DRAFT.md', stage1);
writeFileSync('CRITIQUE_MATRIX.md', stage2 + '\n' + stage3);
writeFileSync('FINAL_SYNTHESIS.md', stage4);
writeFileSync('council-publication.json', JSON.stringify(publication,null,2));
writeFileSync('council-members.json', JSON.stringify({itemNumber,isPr,sourceSha,ownerMode,hold,memberAssessments},null,2));
writeFileSync('council-receipt.json', JSON.stringify({
  ...receipt,
  ownerMode,
  limits,
  flags,
  status,
  actions,
  dialogue,
  publication,
  // Preserve real provider provenance and dissent for trusted release evaluation.
  modelReview:reasoning,
}, null, 2));

console.log(status);
console.log('fingerprint', receipt.fingerprint);
console.log('dialogueTurns', dialogue.turnCount);
console.log('ownerMode', ownerMode);
console.log('policy', limits.mode);
