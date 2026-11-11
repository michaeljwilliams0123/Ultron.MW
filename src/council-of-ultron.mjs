/** Council of Ultron, Phase 1: a GrokBot-style roster around one core brain.
 *
 * Ultron Core is the lead (the Grok-like brain / chief of staff). The seven
 * existing Council roles become member bots, each with a profile, a primary
 * capability lane, skills from the Git-backed hubs, declarative routines, its
 * own memory (profile facts + dated journal) and access to shared memory.
 *
 * This module is advisory and deterministic. It routes and records evidence;
 * it never executes an operation, mints a credential, calls a model or widens
 * any authority. Operations still pass `memberAbilityAdmission` and the
 * existing governed execution path; owner-only decisions escalate to the owner.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { COUNCIL_APP_ROLES } from './council-app-bindings.mjs';
import { COUNCIL_ABILITIES, memberAbilityAdmission } from './council-members.mjs';
import { evaluateHubEntry, snapshotSha, verifyGitHubs } from './git-hubs.mjs';
import { commandsFor } from '../docs/core/capabilities.mjs';

const fail = code => { throw Object.assign(new Error('council-of-ultron-' + code), { code }); };
const freezeDeep = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
};

/** Capability lanes: what "more universal" means in measurable terms. */
export const CAPABILITY_LANES = freezeDeep({
  agentic: { label: 'Agentic', summary: 'Plan, use tools and carry a task to a verified result.',
    signals: ['implement', 'build', 'fix', 'automate', 'execute', 'run ', 'refactor', 'migrate', 'wire', 'ship'] },
  generative: { label: 'Generative', summary: 'Produce text, code, designs and alternatives.',
    signals: ['generate', 'draft', 'write', 'design', 'propose', 'alternative', 'ui', 'copy', 'image', 'diagram', 'scaffold'] },
  predictive: { label: 'Predictive', summary: 'Forecast outcomes, score risk and calibrate confidence.',
    signals: ['predict', 'forecast', 'risk', 'probability', 'estimate', 'likely', 'regression', 'trend', 'score'] },
  'self-improvement': { label: 'Self-improvement', summary: 'Learn from outcomes; evaluate and promote better skills.',
    signals: ['learn', 'improve', 'skill', 'benchmark', 'evaluate', 'retro', 'lesson', 'memory', 'tune'] },
  reasoning: { label: 'General reasoning', summary: 'Analyse, falsify and explain; the measurable path toward AGI-style breadth.',
    signals: ['why', 'analyze', 'analyse', 'prove', 'verify', 'test', 'counterexample', 'root cause', 'compare', 'explain'] },
  reliability: { label: 'Reliability', summary: 'Watch CI, drift and live operations; recover safely.',
    signals: ['ci', 'workflow', 'flaky', 'monitor', 'outage', 'drift', 'latency', 'canary', 'failing', 'health'] },
  governance: { label: 'Governance', summary: 'Authority, provenance, release gates and secrets hygiene.',
    signals: ['permission', 'secret', 'credential', 'token', 'release', 'merge', 'policy', 'provenance', 'branch protection'] },
  continuity: { label: 'Owner continuity', summary: "Keep the owner's latest intent, priorities and status central.",
    signals: ['priority', 'roadmap', 'status', 'summary', 'brief', 'remind', 'owner', 'next step', 'plan'] },
});
export const LANE_IDS = Object.freeze(Object.keys(CAPABILITY_LANES));

/** Operations that only the owner can approve, whatever a member is admitted to. */
export const OWNER_ONLY_OPERATIONS = Object.freeze([
  'pr.merge', 'release.publish', 'deploy.production', 'spend.paid', 'permission.change',
  'secret.write', 'message.external', 'repository.settings',
]);

const ID = /^ultron-[a-z][a-z0-9-]{2,40}$/;
const SKILL_ID = /^[a-z][a-z0-9-]{2,63}$/;
const CRON = /^(\S+\s+){4}\S+$/;
const EVENT = /^[a-z_]+(\.[a-z_:-]+)?$/;
const EVIDENCE = /^(?:https:\/\/github\.com\/michaeljwilliams0123\/(?:Ultron\.MW|mahoraga)\/\S{1,300}|sha256:[a-f0-9]{64}|receipt:[A-Za-z0-9_.:-]{8,160})$/;
const SECRET_LIKE = /(?:sk-[a-zA-Z0-9]{16,}|gh[opusr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const routine = (kind, value, prompt) => ({ kind, [kind === 'cron' ? 'schedule' : 'on']: value, prompt });
const profile = (role, name, description, primaryLane, secondaryLanes, skills, routines) => ({
  id: 'ultron-' + role.toLowerCase(), role, name, description, primaryLane, secondaryLanes,
  skills, routines, memoryNamespace: 'council/' + role.toLowerCase(),
  tools: role === 'Core' ? [] : [...COUNCIL_ABILITIES[role].internal, ...COUNCIL_ABILITIES[role].external],
});

/** Lead brain plus the seven existing Council roles, in roster order. */
export const COUNCIL_ROSTER = freezeDeep([
  profile('Core', 'Ultron', 'Lead brain and chief of staff: triages, routes work to members, merges their evidence and escalates owner decisions.',
    'continuity', LANE_IDS.filter(lane => lane !== 'continuity'), ['repo-review', 'continual-improvement'],
    [routine('event', 'issues.opened', 'Triage the new issue and route it to the right member.'),
      routine('cron', '0 13 * * *', 'Post the daily council brief: what moved, what is blocked, what needs the owner.')]),
  profile('Builder', 'Ultron Builder', 'Ships working changes: turns a spec into a branch, code and tests.',
    'agentic', ['generative'], ['repo-review'],
    [routine('event', 'issues.labeled:council-build', 'Plan and start an implementation branch for the labeled issue.')]),
  profile('Skeptic', 'Ultron Skeptic', 'Breaks assumptions: finds the counterexample and demands a falsifiable test.',
    'reasoning', ['predictive'], ['repo-review'],
    [routine('event', 'pull_request.synchronize', 'Challenge the new head with the strongest counterexample.')]),
  profile('Steward', 'Ultron Steward', 'Guards authority, provenance, secrets hygiene and release gates.',
    'governance', ['continuity'], ['repo-review'],
    [routine('event', 'pull_request.opened', 'Screen protected paths and label governance-sensitive changes.')]),
  profile('Predictor', 'Ultron Predictor', 'Forecasts outcomes, registers calibrated forecasts and scores routing by track record.',
    'predictive', ['self-improvement', 'reasoning'], ['continual-improvement'],
    [routine('cron', '0 12 * * *', 'Resolve due forecasts and publish calibration.')]),
  profile('Generator', 'Ultron Generator', 'Generates alternatives, drafts, designs and candidate skill improvements.',
    'generative', ['agentic', 'self-improvement'], ['continual-improvement'],
    [routine('event', 'issues.labeled:proposal', 'Draft the smallest alternative that satisfies the proposal.')]),
  profile('Sentinel', 'Ultron Sentinel', 'Watches CI, drift and live operations; opens bounded repairs.',
    'reliability', ['predictive', 'agentic'], ['repo-review'],
    [routine('event', 'workflow_run.completed:failure', 'Classify the failed run and route a bounded repair.'),
      routine('cron', '0 * * * *', 'Hourly CI and runtime health snapshot.')]),
  profile('Companion', 'Ultron Companion', "Keeps the owner's intent central: summaries, priorities and decision cards.",
    'continuity', ['generative'], ['repo-review'],
    [routine('cron', '30 13 * * 1', 'Weekly roadmap and acceptance-status digest for the owner.')]),
]);

/** Schema check for one member profile. Returns a frozen copy. */
export function validateMemberProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('profile-invalid');
  const { id, role, name, description, primaryLane, secondaryLanes, skills, routines, memoryNamespace, tools } = input;
  if (!ID.test(id || '') || typeof role !== 'string' || (role !== 'Core' && !COUNCIL_APP_ROLES.includes(role)) ||
      id !== 'ultron-' + role.toLowerCase()) fail('profile-identity-invalid');
  if (typeof name !== 'string' || !name.trim() || name.length > 60 ||
      typeof description !== 'string' || !description.trim() || description.length > 300) fail('profile-text-invalid');
  if (!LANE_IDS.includes(primaryLane) || !Array.isArray(secondaryLanes) ||
      secondaryLanes.some(lane => !LANE_IDS.includes(lane) || lane === primaryLane) ||
      new Set(secondaryLanes).size !== secondaryLanes.length) fail('profile-lanes-invalid');
  if (!Array.isArray(skills) || !skills.length || skills.some(skill => !SKILL_ID.test(skill))) fail('profile-skills-invalid');
  if (!Array.isArray(routines) || routines.some(r => !r || typeof r.prompt !== 'string' || !r.prompt.trim() ||
      !((r.kind === 'cron' && CRON.test(r.schedule || '')) || (r.kind === 'event' && EVENT.test(r.on || ''))))) fail('profile-routines-invalid');
  if (memoryNamespace !== 'council/' + role.toLowerCase()) fail('profile-memory-invalid');
  if (!Array.isArray(tools)) fail('profile-tools-invalid');
  const declared = role === 'Core' ? [] : [...COUNCIL_ABILITIES[role].internal, ...COUNCIL_ABILITIES[role].external];
  // A profile may narrow but never widen the role's admitted surface.
  if (tools.some(op => !declared.includes(op) || OWNER_ONLY_OPERATIONS.includes(op))) fail('profile-tools-widen-authority');
  return freezeDeep(structuredClone(input));
}

export function validateRoster(roster = COUNCIL_ROSTER) {
  if (!Array.isArray(roster) || !roster.length) fail('roster-invalid');
  const members = roster.map(validateMemberProfile);
  if (new Set(members.map(m => m.id)).size !== members.length) fail('roster-duplicate');
  if (members.filter(m => m.role === 'Core').length !== 1) fail('roster-core-required');
  return Object.freeze(members);
}

/** Map hub skills to members. Requires the full hub integrity gate first. */
export async function loadCouncilSkills(root, roster = COUNCIL_ROSTER) {
  const members = validateRoster(roster);
  await verifyGitHubs(root);
  const catalog = JSON.parse(await readFile(resolve(root, 'hubs/catalog.json'), 'utf8'));
  const tests = [...new Set(catalog.entries.flatMap(entry => entry.tests))];
  const skills = {};
  for (const entry of catalog.entries.filter(item => item.kind === 'skill')) {
    const accepted = evaluateHubEntry({ entry, source: await readFile(resolve(root, entry.path), 'utf8'), tests });
    skills[accepted.id] = { id: accepted.id, path: accepted.path, revision: accepted.revision, sha256: accepted.sha256,
      members: members.filter(m => m.skills.includes(accepted.id)).map(m => m.id) };
  }
  for (const member of members) for (const skill of member.skills)
    if (!skills[skill]) fail('unknown-skill:' + skill);
  return freezeDeep(skills);
}

const isoNow = () => new Date().toISOString();
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
function cleanText(value, max, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(code);
  if (SECRET_LIKE.test(value)) fail('credential-like-material');
  return value.trim();
}
function cleanEvidence(list) {
  const items = Array.isArray(list) ? list : [list];
  if (!items.length || items.length > 10 || items.some(item => typeof item !== 'string' || !EVIDENCE.test(item)))
    fail('evidence-invalid');
  return [...new Set(items)];
}

/** Per-member memory (profile facts + dated journal) plus shared memory.
 * Mirrors a GrokBot's own memory and the user's shared memory. Writes are
 * namespaced by the acting member; shared facts require linked evidence.
 */
export function createCouncilMemory({ roster = COUNCIL_ROSTER, now = isoNow, journalLimit = 200, state } = {}) {
  const members = validateRoster(roster);
  if (!Number.isSafeInteger(journalLimit) || journalLimit < 1 || journalLimit > 5000) fail('journal-limit-invalid');
  const data = state ? structuredClone(state) :
    { schema: 'ultron.council-memory.v1', members: {}, shared: [], outcomes: [] };
  for (const m of members) data.members[m.id] ||= { namespace: m.memoryNamespace, profile: {}, journal: [] };
  const own = id => {
    if (!members.some(m => m.id === id)) fail('member-unknown');
    return data.members[id];
  };
  const stamp = () => { const at = now(); if (!ISO.test(at)) fail('clock-invalid'); return at; };
  const api = {
    remember(memberId, key, value) {
      const slot = own(memberId);
      if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(key || '')) fail('fact-key-invalid');
      slot.profile[key] = { value: cleanText(value, 500, 'fact-invalid'), at: stamp() };
      return Object.freeze({ ...slot.profile[key] });
    },
    journal(memberId, { kind = 'note', text, lane = null, outcome = null, evidence = [] } = {}) {
      const slot = own(memberId);
      if (!/^[a-z][a-z-]{1,31}$/.test(kind)) fail('journal-kind-invalid');
      if (lane !== null && !LANE_IDS.includes(lane)) fail('journal-lane-invalid');
      if (outcome !== null && !['succeeded', 'failed', 'held'].includes(outcome)) fail('journal-outcome-invalid');
      const entry = { at: stamp(), kind, text: cleanText(text, 1000, 'journal-text-invalid'), lane, outcome,
        evidence: evidence.length ? cleanEvidence(evidence) : [] };
      slot.journal.push(entry);
      if (slot.journal.length > journalLimit) slot.journal.splice(0, slot.journal.length - journalLimit);
      return Object.freeze({ ...entry });
    },
    share(memberId, { fact, evidence } = {}) {
      own(memberId);
      const entry = { at: stamp(), by: memberId, fact: cleanText(fact, 500, 'shared-fact-invalid'), evidence: cleanEvidence(evidence) };
      data.shared.push(entry);
      if (data.shared.length > journalLimit) data.shared.splice(0, data.shared.length - journalLimit);
      return Object.freeze({ ...entry });
    },
    recordOutcome(entry) {
      if (!entry || !/^[a-f0-9]{64}$/.test(entry.routing || '') || !members.some(m => m.id === entry.lead) ||
          !Array.isArray(entry.lanes) || !entry.lanes.length || entry.lanes.some(lane => !LANE_IDS.includes(lane)) ||
          !['succeeded', 'failed', 'held'].includes(entry.status)) fail('outcome-invalid');
      data.outcomes.push({ ...structuredClone(entry), evidence: cleanEvidence(entry.evidence), at: stamp() });
      if (data.outcomes.length > journalLimit * 5) data.outcomes.shift();
    },
    recall(memberId) {
      const slot = own(memberId);
      return freezeDeep(structuredClone({ id: memberId, namespace: slot.namespace, profile: slot.profile,
        journal: slot.journal, shared: data.shared }));
    },
    outcomes: () => freezeDeep(structuredClone(data.outcomes)),
    snapshot() {
      const body = structuredClone(data);
      return freezeDeep({ ...body, sha256: snapshotSha(body) });
    },
  };
  return Object.freeze(api);
}

/** Restore durable memory; the digest must match (tamper-evident, not secret). */
export function restoreCouncilMemory(snapshot, options = {}) {
  if (!snapshot || snapshot.schema !== 'ultron.council-memory.v1') fail('snapshot-invalid');
  const { sha256, ...body } = snapshot;
  if (snapshotSha(body) !== sha256) fail('snapshot-digest-mismatch');
  return createCouncilMemory({ ...options, state: body });
}

/** Deterministic lane inference from the objective text. */
export function inferLanes(objective) {
  const text = ' ' + cleanText(objective, 2000, 'objective-invalid').toLowerCase() + ' ';
  const hits = LANE_IDS.map(lane => ({ lane,
    weight: CAPABILITY_LANES[lane].signals.filter(signal => new RegExp('(^|[^a-z])' +
      signal.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text)).length }))
    .filter(hit => hit.weight > 0)
    .sort((a, b) => b.weight - a.weight || LANE_IDS.indexOf(a.lane) - LANE_IDS.indexOf(b.lane));
  return Object.freeze(hits.length ? hits.map(hit => Object.freeze(hit)) : [Object.freeze({ lane: 'reasoning', weight: 1 })]);
}

/** Track record per member and lane from recorded outcomes (Laplace smoothed). */
export function councilScorecard(memory) {
  const card = {};
  for (const outcome of memory.outcomes()) for (const lane of outcome.lanes) {
    const slot = ((card[outcome.lead] ||= {})[lane] ||= { attempts: 0, successes: 0, rate: 0.5 });
    if (outcome.status === 'held') continue;
    slot.attempts += 1;
    if (outcome.status === 'succeeded') slot.successes += 1;
    slot.rate = Number(((slot.successes + 1) / (slot.attempts + 2)).toFixed(4));
  }
  return freezeDeep(card);
}

/** Lead → members routing with evidence. Advisory only: `executes` is always false. */
export function routeCouncilTask(task, { roster = COUNCIL_ROSTER, memory = null, maxMembers = 3 } = {}) {
  const members = validateRoster(roster);
  if (!task || typeof task !== 'object' || !/^[a-z0-9][a-z0-9:._-]{2,80}$/.test(task.id || '')) fail('task-invalid');
  const objective = cleanText(task.objective, 2000, 'objective-invalid');
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 7) fail('max-members-invalid');
  const lanes = task.lanes ? task.lanes.map(lane => {
    if (!LANE_IDS.includes(lane)) fail('task-lane-invalid');
    return { lane, weight: 1 };
  }) : inferLanes(objective);
  const operations = Array.isArray(task.operations) ? task.operations : [];
  if (operations.some(op => typeof op !== 'string' || !/^[a-z][a-z0-9.-]{2,60}$/.test(op))) fail('task-operations-invalid');
  const card = memory ? councilScorecard(memory) : {};
  const scored = members.filter(m => m.role !== 'Core').map(member => {
    let fit = 0;
    const reasons = [];
    for (const { lane, weight } of lanes) {
      const match = member.primaryLane === lane ? 1 : member.secondaryLanes.includes(lane) ? 0.5 : 0;
      if (!match) continue;
      const rate = card[member.id]?.[lane]?.rate ?? 0.5;
      fit += weight * match * (0.5 + rate);
      reasons.push(lane + (match === 1 ? ':primary' : ':secondary') + ':rate=' + rate);
    }
    return { id: member.id, role: member.role, score: Number(fit.toFixed(4)), reasons };
  }).sort((a, b) => b.score - a.score || members.findIndex(m => m.id === a.id) - members.findIndex(m => m.id === b.id));
  const selected = scored.filter(item => item.score > 0).slice(0, maxMembers);
  if (!selected.length) selected.push(scored.find(item => item.role === 'Skeptic'));
  // The Skeptic challenges any build or generation, like an independent review lane.
  const builds = lanes.some(l => ['agentic', 'generative'].includes(l.lane));
  if (builds && !selected.some(item => item.role === 'Skeptic')) selected.push(scored.find(item => item.role === 'Skeptic'));
  const lead = selected[0];
  const admission = operations.map(op => {
    if (OWNER_ONLY_OPERATIONS.includes(op)) return { op, admitted: false, reason: 'owner-only' };
    let by = selected.find(item => memberAbilityAdmission(item.role, op).allowed);
    if (!by) {
      // Bring in the member that holds the tool, as a GrokBot lead would.
      by = scored.find(item => memberAbilityAdmission(item.role, op).allowed);
      if (by) { by.operator = true; selected.push(by); }
    }
    return by ? { op, admitted: true, by: by.id, mode: memberAbilityAdmission(by.role, op).mode }
      : { op, admitted: false, reason: 'no-member-admitted' };
  });
  const escalations = [];
  for (const item of admission.filter(a => !a.admitted))
    escalations.push({ to: 'owner', op: item.op, reason: item.reason });
  if (lanes.some(l => l.lane === 'governance')) escalations.push({ to: 'owner', reason: 'governance-lane-requires-owner-decision' });
  const body = {
    schema: 'ultron.council-routing.v1', taskId: task.id, objectiveSha256: snapshotSha({ objective }),
    lanes: lanes.map(l => l.lane), coordinator: 'ultron-core', voice: 'ultron-companion', lead: lead.id,
    members: selected.map(item => ({ id: item.id, role: item.role, score: item.score, reasons: item.reasons,
      duty: item === lead ? 'lead' : item.operator ? 'operator' : item.role === 'Skeptic' && builds ? 'challenge' : 'support' })),
    candidates: scored.map(({ id, score }) => ({ id, score })), admission, escalations,
    decision: escalations.length ? 'escalate-to-owner' : 'route',
    // Trust model: routing is advice. It is never a release vote, a status
    // check or an approval, and text can only add escalations, never remove them.
    authority: 'advisory-only', executes: false, countsAsApproval: false,
  };
  return freezeDeep({ ...body, fingerprint: snapshotSha(body) });
}

/** Close the loop: write evidence-backed outcomes into memory for future routing. */
export function recordCouncilOutcome(memory, routing, { status, evidence, note = '' } = {}) {
  if (!routing || routing.schema !== 'ultron.council-routing.v1') fail('routing-invalid');
  const { fingerprint, ...body } = routing;
  if (snapshotSha(body) !== fingerprint) fail('routing-fingerprint-mismatch');
  if (!['succeeded', 'failed', 'held'].includes(status)) fail('outcome-status-invalid');
  const links = cleanEvidence(evidence);
  if (memory.outcomes().some(o => o.routing === fingerprint)) fail('outcome-already-recorded');
  const text = note ? cleanText(note, 500, 'note-invalid') : status + ' for ' + routing.taskId;
  memory.journal(routing.lead, { kind: 'outcome', text, lane: routing.lanes[0], outcome: status, evidence: links });
  // Evidence links are references to read back independently, not proof by themselves.
  const entry = { routing: fingerprint, taskId: routing.taskId, lead: routing.lead, lanes: [...routing.lanes], status, evidence: links,
    evidenceVerified: false };
  memory.recordOutcome(entry);
  return freezeDeep(structuredClone(entry));
}

/** Natural language to the existing read-only slash commands (Council Room front door).
 * Only commands already registered in docs/core/capabilities.mjs can be returned. */
const COMMAND_INTENTS = Object.freeze([
  ['/system status', /\b(system )?(status|health|uptime|is (it|ultron) (up|running|ok))\b/],
  ['/repo inspect', /\b(inspect|look at|what'?s in|summari[sz]e) (the )?(repo|repository|codebase)\b/],
  ['/learning status', /\b(learning|what (have|did) you learn(ed)?|lessons)\b/],
  ['/self scan', /\b(self[- ]?scan|scan (yourself|ultron))\b/],
  ['/help', /^(help|\/help|what can you do\??)$|\bwhat can you do\b/],
]);
export function mapOwnerMessage(text) {
  const message = cleanText(text, 2000, 'message-invalid');
  const allowed = new Set(commandsFor('local'));
  if (message.startsWith('/')) {
    return Object.freeze({ intent: allowed.has(message) ? 'command' : 'unknown-command',
      command: allowed.has(message) ? message : null, lanes: Object.freeze([]) });
  }
  const lower = message.toLowerCase();
  const hit = COMMAND_INTENTS.find(([command, pattern]) => allowed.has(command) && pattern.test(lower));
  if (hit) return Object.freeze({ intent: 'command', command: hit[0], lanes: Object.freeze([]) });
  return Object.freeze({ intent: 'task', command: null, lanes: Object.freeze(inferLanes(message).map(h => h.lane)) });
}

/** Companion speaks first, in plain language, with in-thread progress and
 * approval cards for anything the owner must decide. Drafts only: nothing is sent. */
export function companionReply(routing, { roster = COUNCIL_ROSTER } = {}) {
  if (!routing || routing.schema !== 'ultron.council-routing.v1') fail('routing-invalid');
  const { fingerprint, ...body } = routing;
  if (snapshotSha(body) !== fingerprint) fail('routing-fingerprint-mismatch');
  const name = id => validateRoster(roster).find(m => m.id === id)?.name || id;
  const helpers = routing.members.filter(m => m.duty !== 'lead').map(m => name(m.id) + ' (' + m.duty + ')');
  const lanes = routing.lanes.map(l => CAPABILITY_LANES[l].label.toLowerCase()).join(', ');
  const lines = [name(routing.lead) + ' is taking the lead on this (' + lanes + ').'];
  if (helpers.length) lines.push('Working with: ' + helpers.join(', ') + '.');
  lines.push(routing.escalations.length
    ? 'I need your decision on ' + routing.escalations.length + ' item' + (routing.escalations.length > 1 ? 's' : '') + ' before anything happens.'
    : 'Nothing here needs your approval yet. I will post progress in this thread.');
  return freezeDeep({
    schema: 'ultron.companion-reply.v1', speaker: 'ultron-companion', routing: fingerprint,
    text: lines.join(' '),
    progress: routing.members.map(m => ({ member: m.id, duty: m.duty, state: 'queued' })),
    cards: routing.escalations.map(e => ({ kind: 'approval', to: 'owner', op: e.op || null, reason: e.reason,
      choices: ['approve', 'decline'] })),
    sent: false,
  });
}
