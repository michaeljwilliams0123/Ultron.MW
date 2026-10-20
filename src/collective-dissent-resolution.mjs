import { createHash } from 'node:crypto';

const EVIDENCE_KEYS = new Set(['evidenceRef', 'status', 'freshness', 'lineageRoot', 'supersededBy']);
const HISTORY_KEYS = new Set(['individualId', 'conclusion', 'dissentTags', 'evidenceRefs', 'unresolvedCycles', 'lastObservation']);
const EVIDENCE_STATUSES = new Set(['valid', 'invalid', 'refuted']);
const FRESHNESS = new Set(['current', 'aging', 'stale', 'historical']);
const OBSERVATIONS = new Set([
  'none',
  'requested',
  'performed-supports-dissent',
  'performed-supports-alternative',
  'performed-inconclusive',
]);
const DISSENT_ESCALATION_CYCLES = 3;
const REQUIRED_ALTERNATIVE_PARTICIPANTS = 2;
const REQUIRED_ALTERNATIVE_LINEAGES = 2;

export function resolveCollectiveDissent({ positions = [], materialDissent = [], evidenceLedger = [], dissentHistory = [] } = {}) {
  if (!Array.isArray(positions) || positions.length > 12 || !Array.isArray(materialDissent) || materialDissent.length > 12) fail('collective-dissent-resolution-invalid');
  const ledger = normalizeEvidenceLedger(evidenceLedger);
  const history = normalizeHistory(dissentHistory);
  const dissentIds = new Set(materialDissent.map((item) => checkedSlug(item?.individualId, 'collective-dissent-resolution-invalid')));
  const positionById = new Map(positions.map((item) => [checkedSlug(item?.individualId, 'collective-dissent-resolution-invalid'), item]));
  const alternativeSupport = strongestAlternativeSupport({ positions, dissentIds, ledger });
  const items = materialDissent.map((dissent) => {
    const position = positionById.get(dissent.individualId);
    if (!position) fail('collective-dissent-position-missing');
    const evidenceRefs = checkedList(position.evidenceRefs, 32, 'collective-dissent-resolution-invalid');
    const evidence = evidenceRefs.map((evidenceRef) => publicEvidence(evidenceRef, ledger.get(evidenceRef)));
    const currentValid = evidence.filter((item) => item.status === 'valid' && item.freshness === 'current' && item.supersededBy === null);
    const fullyCovered = evidence.every((item) => item.status !== 'unverified');
    const degraded = fullyCovered && evidence.length > 0 && currentValid.length === 0 && evidence.every(isDegradedEvidence);
    const historyEntry = matchingHistory(history.get(dissent.individualId), dissent, evidenceRefs);
    const unresolvedCycles = historyEntry?.unresolvedCycles ?? 0;
    const priorObservation = historyEntry?.lastObservation ?? 'none';
    const escalation = unresolvedCycles >= DISSENT_ESCALATION_CYCLES;
    const status = classifyDissent({ escalation, fullyCovered, currentValid, degraded, alternativeQualified: alternativeSupport.qualified });
    return deepFreeze({
      individualId: dissent.individualId,
      conclusion: position.conclusion,
      dissentTags: checkedSlugList(position.dissentTags ?? [], 16, 'collective-dissent-resolution-invalid'),
      evidence,
      unresolvedCycles,
      priorObservation,
      status,
      escalation,
    });
  });
  const core = {
    schemaVersion: 1,
    kind: 'collective-dissent-resolution',
    items,
    alternativeSupport,
    materialDissentCount: materialDissent.length,
  };
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

function strongestAlternativeSupport({ positions, dissentIds, ledger }) {
  const groups = new Map();
  for (const position of positions) {
    const id = checkedSlug(position?.individualId, 'collective-dissent-resolution-invalid');
    if (dissentIds.has(id)) continue;
    const conclusion = checkedSlug(position.conclusion, 'collective-dissent-resolution-invalid');
    const evidenceRefs = checkedList(position.evidenceRefs ?? [], 32, 'collective-dissent-resolution-invalid');
    const lineageRoots = new Set();
    for (const ref of evidenceRefs) {
      const item = ledger.get(ref);
      if (item?.status === 'valid' && item.freshness === 'current' && item.supersededBy === null && item.lineageRoot) {
        lineageRoots.add(item.lineageRoot);
      }
    }
    const group = groups.get(conclusion) || { conclusion, participantIds: new Set(), lineageRoots: new Set() };
    group.participantIds.add(id);
    for (const root of lineageRoots) group.lineageRoots.add(root);
    groups.set(conclusion, group);
  }
  let best = null;
  for (const group of groups.values()) {
    if (!best || group.participantIds.size > best.participantIds.size) best = group;
  }
  if (!best) return deepFreeze({ conclusion: null, currentIndependentLineageCount: 0, currentParticipantCount: 0, lineageRoots: [], qualified: false });
  return deepFreeze({
    conclusion: best.conclusion,
    currentIndependentLineageCount: best.lineageRoots.size,
    currentParticipantCount: best.participantIds.size,
    lineageRoots: [...best.lineageRoots].sort(),
    qualified: isQualifiedAlternative(best),
  });
}
function isQualifiedAlternative(group) { return group.lineageRoots.size >= REQUIRED_ALTERNATIVE_LINEAGES && group.participantIds.size >= REQUIRED_ALTERNATIVE_PARTICIPANTS; }
function normalizeEvidenceLedger(evidenceLedger) {
  if (!Array.isArray(evidenceLedger) || evidenceLedger.length > 64) fail('collective-dissent-resolution-invalid');
  const map = new Map();
  for (const item of evidenceLedger) {
    exact(item, EVIDENCE_KEYS, 'collective-dissent-resolution-invalid');
    const evidenceRef = checkedRef(item.evidenceRef, 'collective-dissent-resolution-invalid');
    allowed(item.status, EVIDENCE_STATUSES, 'collective-dissent-resolution-invalid');
    allowed(item.freshness, FRESHNESS, 'collective-dissent-resolution-invalid');
    const lineageRoot = item.lineageRoot === null ? null : checkedSlug(item.lineageRoot, 'collective-dissent-resolution-invalid');
    const supersededBy = item.supersededBy === null ? null : checkedRef(item.supersededBy, 'collective-dissent-resolution-invalid');
    map.set(evidenceRef, deepFreeze({ evidenceRef, status: item.status, freshness: item.freshness, lineageRoot, supersededBy }));
  }
  return map;
}
function normalizeHistory(dissentHistory) {
  if (!Array.isArray(dissentHistory) || dissentHistory.length > 64) fail('collective-dissent-resolution-invalid');
  const map = new Map();
  for (const item of dissentHistory) {
    exact(item, HISTORY_KEYS, 'collective-dissent-resolution-invalid');
    const individualId = checkedSlug(item.individualId, 'collective-dissent-resolution-invalid');
    allowed(item.lastObservation, OBSERVATIONS, 'collective-dissent-resolution-invalid');
    if (!Number.isSafeInteger(item.unresolvedCycles) || item.unresolvedCycles < 0 || item.unresolvedCycles > 32) fail('collective-dissent-resolution-invalid');
    map.set(individualId, deepFreeze({
      individualId,
      conclusion: checkedSlug(item.conclusion, 'collective-dissent-resolution-invalid'),
      dissentTags: checkedSlugList(item.dissentTags ?? [], 16, 'collective-dissent-resolution-invalid'),
      evidenceRefs: checkedList(item.evidenceRefs ?? [], 32, 'collective-dissent-resolution-invalid'),
      unresolvedCycles: item.unresolvedCycles,
      lastObservation: item.lastObservation,
    }));
  }
  return map;
}
function matchingHistory(item, dissent, evidenceRefs) {
  if (!item) return null;
  const tags = checkedSlugList(dissent.dissentTags ?? [], 16, 'collective-dissent-resolution-invalid');
  return item.conclusion === dissent.conclusion && sameList(item.dissentTags, tags) && sameList(item.evidenceRefs, evidenceRefs) ? item : null;
}
function publicEvidence(evidenceRef, item) {
  if (!item) return deepFreeze({ evidenceRef, status: 'unverified', freshness: 'unknown', lineageRoot: null, supersededBy: null });
  return deepFreeze({
    evidenceRef: item.evidenceRef,
    status: item.status,
    freshness: item.freshness,
    lineageRoot: item.lineageRoot,
    supersededBy: item.supersededBy,
  });
}
function isDegradedEvidence(item) {
  return item.status === 'invalid' || item.status === 'refuted' || item.freshness === 'stale' || item.freshness === 'historical' || item.supersededBy !== null;
}
function classifyDissent({ escalation, fullyCovered, currentValid, degraded, alternativeQualified }) {
  if (escalation) return 'dissent-resolution-escalated';
  if (!fullyCovered) return 'evidence-unverified';
  if (currentValid.length > 0) return 'current-valid-dissent';
  if (degraded && alternativeQualified) return 'degraded-dissent-with-independent-alternative';
  if (degraded) return 'degraded-dissent-without-independent-alternative';
  return 'dissent-evidence-reobservation-required';
}
function checkedList(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum) fail(code);
  return value.map((item) => checkedRef(item, code)).sort();
}
function checkedSlugList(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum) fail(code);
  return value.map((item) => checkedSlug(item, code)).sort();
}
function checkedRef(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) fail(code);
  return value;
}
function checkedSlug(value, code) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) fail(code);
  return value;
}
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.size || Object.keys(value).some((key) => !keys.has(key))) fail(code);
  return value;
}
function allowed(value, values, code) { if (!values.has(value)) fail(code); return value; }
function sameList(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
function fail(code) { const error = new TypeError(code); error.code = code; throw error; }
