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
import {deriveCouncilFlags} from '../src/council-case-flags.mjs';
import {buildCouncilExactHeadEvidence} from '../src/council-exact-head-evidence.mjs';
import {summarizeCouncilIdentityEvidence} from '../src/council-app-identities.mjs';
import {runReasoningRound,buildCouncilReasoningInput} from '../src/council-reasoning.mjs';
import {buildCouncilPrContext,formatCouncilPrContext} from '../src/council-pr-context.mjs';
import {signCouncilRoleVerdict,deriveCouncilRolePublicKeys} from '../src/council-role-attestation.mjs';
import {formatCouncilTaintEvidence} from '../src/council-taint-evidence.mjs';
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
const itemNumber=Number(item)||0;

// Caller is trusted main-workflow GitHub REST readback; never PR text.
// Read this before deliberation so verified exact-head CI, rather than PR prose
// length, determines evidence coverage. Partial or stale evidence remains held.
let reviewEvidence=null;
try{
 const path=process.env.COUNCIL_REVIEW_EVIDENCE_FILE;
 if(path&&isPr){
  const data=JSON.parse(readFileSync(path,'utf8'));
  reviewEvidence=buildCouncilExactHeadEvidence(data);
 }
}catch{reviewEvidence=null;}
const exactHeadEvidence=reviewEvidence?.verified===true&&
 reviewEvidence.sourceSha===sourceSha&&reviewEvidence.prNumber===itemNumber;

const flags = deriveCouncilFlags({title,body,isPr,
  originalSecuritySignal:process.env.ORIGINAL_SECURITY_SIGNAL});

const large = body.length > 2000;
let evidenceCoverage = flags.security ? 0.35 : exactHeadEvidence ? 0.9 : large ? 0.65 : 0.9;
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
// Read only provider-fetched exact-head files from the trusted workflow.
let prContext=null;
try{
 const path=process.env.COUNCIL_PR_FILES_FILE;
 if(path&&isPr){
  const payload=JSON.parse(readFileSync(path,'utf8'));
  if(payload.sourceSha===sourceSha&&payload.prNumber===itemNumber){
   prContext=buildCouncilPrContext(payload);
  }
 }
}catch{prContext=null;}
let taintEvidence=null;
try{
 if(isPr&&process.env.COUNCIL_TAINT_EVIDENCE_FILE){
  const e=JSON.parse(readFileSync(process.env.COUNCIL_TAINT_EVIDENCE_FILE,'utf8'));
  if(e.schema==='ultron.council-taint-evidence.v1'&&e.sourceSha===sourceSha&&
    e.prNumber===itemNumber)taintEvidence=e;
 }
}catch{taintEvidence=null;}
const memberAssessments=assessCouncil({
  title,body,isPr,itemNumber,sourceSha,flags,ownerMode,
  reviewEvidence:reviewEvidence?.sourceSha===sourceSha?reviewEvidence:null,
  governorPositions:receipt.positions
});
const icon=v=>v==='proceed'?'✅':'⛔';
const memberTable='| Member | Deterministic advisory vote | Screening reason | Proposed action (not executed) |\n|---|---|---|---|\n'+
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
if(!isPr)actions.push('For implementation, use the existing owner-authorized \u0060@ultron implement …\u0060 issue router.');
else if(prContext)actions.push('Review the exact-head changed-file analysis below: '+prContext.filesRendered+'/'+prContext.filesObserved+' file excerpts; coverage '+(prContext.complete?'complete':'partial')+'.');
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

const reasoning = await runReasoningRound({
  input: buildCouncilReasoningInput({title,body,sourceSha,prNumber:itemNumber,reviewEvidence,prContext,taintEvidence})
});
// A shared-root signature proves record integrity, not independent GitHub
// reviewer identity. Only the trusted main-only gate receives the root seed.
let roleAttestations=[],rolePublicKeys={};
const root=process.env.COUNCIL_MASTER_SEED||'';
if(root&&isPr&&/^[a-f0-9]{40}$/.test(sourceSha)){
 try{
  rolePublicKeys=deriveCouncilRolePublicKeys(root);
  roleAttestations=Object.entries(reasoning.results).map(([role,v])=>
   signCouncilRoleVerdict({role,prNumber:itemNumber,sourceSha,
    verdict:v.verdict,confidence:v.confidence,source:v.source,
    inputDigest:v.inputDigest,rationale:v.rationale,
    findings:v.findings||[]},root));
 }catch(error){
  roleAttestations=[];rolePublicKeys={};
  console.warn('Council role attestation held: '+String(error.message).slice(0,100));
 }
}
writeFileSync('council-role-attestations.json',JSON.stringify({
 schema:'ultron.council-role-attestations.v1',sourceSha,prNumber:itemNumber,
 signedRoles:roleAttestations.length,independentGithubReview:false,
 signerAuthority:'shared-council-controller',publicKeys:rolePublicKeys,
 verdicts:roleAttestations
},null,2));
const modelRoleCount=Object.keys(reasoning.results).length;
const codeEvidence=prContext?formatCouncilPrContext(prContext):
  'Exact-head diff was not fetched/verified. No file-specific conclusions can be claimed.';
const asLine=value=>String(value||'').replace(/\\s+/g,' ').slice(0,450);
const reasoningSection='\n### Specialized model review (advisory; not authenticated GitHub reviewers)\n'+
 Object.entries(reasoning.results).map(([role,v])=>{
  const basis=v.source==='model'?v.provider+'/'+v.modelId:
    'deterministic fallback ('+v.fallbackReason+')';
  return '- **'+role+'** — '+basis+'; **'+v.verdict+'** ('+v.confidence+')\n'+
   '  - Assessment: '+asLine(v.rationale)+'\n'+
   '  - Code hypotheses: '+(v.findings?.length?v.findings.map(asLine).join(' | '):'none evidenced')+'\n'+
   '  - Falsifying tests: '+(v.tests?.length?v.tests.map(asLine).join(' | '):'none supplied');
 }).join('\n')+
 (reasoning.disagreement?'\n**Disagreement is unresolved.**\n':'\n');
const modelNote=reasoning.modelInvocations+' of '+modelRoleCount+
 ' reasoning roles invoked a real free-tier model; deterministic role votes remain advisory';
const stage1 = `# Stage 1 — Architect framing
**Target:** #${item} — ${title}
**Kind:** ${isPr ? 'pull_request' : 'issue'} · **Owner mode:** ${ownerMode ? 'yes' : 'no'} · **Policy:** ${limits.mode}

## Proposal (bounded)
${body || '(empty body)'}

## System framing
- Deterministic GrokBot council (advisory-only)
- Multi-turn inter-self dialogue attached
- modelInvocations=${reasoning.modelInvocations}/${modelRoleCount} · paidCreditCost=0
- Flags: ${Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
`;

const stage2 = `# Stage 2 — Crucible (Red Team + Pragmatist)

### Red Team
1. Changed-file coverage: ${prContext ? prContext.filesRendered+'/'+prContext.filesObserved : 'unavailable'}. Source: ${sourceSha || '(issue)'}. No claim of AST taint proof without an AST analyzer.
2. Highest-signal changed paths: ${prContext?.files.slice(0,5).map(f=>f.path+' ['+f.tag+']').join(', ') || 'none available'}. Model inputs are bounded; unsafe patches are omitted.
3. No automatic push to protected main; do not replay uncertain external writes or treat role signatures as separate App approvals.
${flags.security ? '4. Sensitive changed files or missing trusted file evidence — mandatory owner review.' : ''}
${flags.autonomy ? '5. Autonomy-expansion language present — confirm owner intent.' : ''}

### Pragmatist
1. Prefer label-gated or owner-triggered runs to control CI cost.
2. Keep reports bounded; full receipt is an artifact.
3. Decision is advisory — does not merge, deploy, or widen capability registry by itself.
`;

const stage3 = `# Stage 3 — Architect rebuttal / refinement
1. Suggested test targets: ${prContext?.files.filter(f=>f.tag==='test').slice(0,5).map(f=>f.path).join(', ') || 'No changed test file observed; existing test coverage must be checked explicitly'}.
2. Reviewed file categories: ${[...new Set(prContext?.files.map(f=>f.tag)||[])].join(', ') || 'not observed'}; require exact-head tests for code changes.
3. Release status remains distinct from advisory findings, authenticated App execution and owner-only signing.
`;

const stage4 = `# Ultron Council Report
${publication.marker}

**Target:** #${item} — ${title}<br>
**Status:** **${status}** · ${proceedCount}/7 members say proceed<br>
**Observed:** ${observedAt}

### Council screening (deterministic, not model-backed approvals)
${memberTable}

**Identities:** \`${configuredCount}/7\` have credential fields configured (not authentication); \`${independentCount}/7\` have independently authenticated authorship proven by this report; \`${receiptProven}/7\` have verified App execution receipts. This report is posted by github-actions, not seven App accounts. App authentication must be established at execution time. ${modelNote}, not independent review.

### Bounded static AST taint findings
${taintEvidence?formatCouncilTaintEvidence(taintEvidence):
  'Not observed. A missing AST finding does not prove security.'}

### Exact-head source evidence (untrusted code, bounded)

<details><summary>Changed files and patch excerpts</summary>

\u0060\u0060\u0060text
${codeEvidence}
\u0060\u0060\u0060

</details>

**Role signing:** ${roleAttestations.length}/${modelRoleCount} Ed25519 role records signed by one shared Council controller; **not independent GitHub App approvals**.\n\n${reasoningSection}
### Proposed capabilities (execution requires independent receipts)
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
*Ultron Council · seven logical roles; only independently authenticated operations count as executed*
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
  roleSigning:{signedRoles:roleAttestations.length,independentGithubReview:false},
}, null, 2));

console.log(status);
console.log('fingerprint', receipt.fingerprint);
console.log('dialogueTurns', dialogue.turnCount);
console.log('ownerMode', ownerMode);
console.log('policy', limits.mode);
