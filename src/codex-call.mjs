import { createHash } from 'node:crypto';
import { CODEX_AUTHORS, parseCodexObjective } from '../docs/core/codex-authors.mjs';

export const CODEX_REPOSITORY = 'michaeljwilliams0123/Ultron.MW';
export const CODEX_OWNER = 'michaeljwilliams0123';
export const CODEX_CALL_MARKER = 'ULTRON_CODEX_CALL_V1';
const SHA = /^[a-f0-9]{40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const validNumber = value => Number.isSafeInteger(value) && value > 0;

/**
 * A validated, immutable audit/transport policy. Ultron's current identities
 * remain the defaults; foreign repositories must supply explicit trusted
 * values and their own enrolled author registry.
 */
export function createCodexPolicy(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw Error('Invalid Codex policy');
  const keys = ['repository','owner','baseBranch','branchPrefix','prTitlePrefix',
    'issueTitle','issueMarker','trustedPrActors','workflowName','jobName','authors'];
  if (Object.keys(options).some(key => !keys.includes(key)))
    throw Error('Unknown Codex policy setting');
  const p = {
    repository: CODEX_REPOSITORY, owner: CODEX_OWNER, baseBranch: 'main',
    branchPrefix: 'ultron/issue-', prTitlePrefix: '[Ultron Codex] ',
    issueTitle: '[Ultron PR] Create proposal', issueMarker: 'ULTRON_PR_V1',
    trustedPrActors: [CODEX_OWNER, 'github-actions[bot]'],
    workflowName: 'Ultron core verification', jobName: 'test',
    authors: CODEX_AUTHORS, ...options,
  };
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/;
  const path = /^[A-Za-z0-9_.-]{1,100}$/;
  const branch = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,80}$/;
  const clean = value => typeof value === 'string' && value.length > 0 &&
    value.length <= 120 && ![...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '\\');
  if (!clean(p.owner) || !login.test(p.owner) ||
      typeof p.repository !== 'string' || p.repository.split('/').length !== 2 ||
      p.repository.split('/')[0] !== p.owner ||
      !path.test(p.repository.split('/')[1]) ||
      !branch.test(p.baseBranch) || !branch.test(p.branchPrefix) ||
      p.baseBranch.includes('..') || p.branchPrefix.includes('..') ||
      !clean(p.prTitlePrefix) || !clean(p.issueTitle) || !clean(p.issueMarker) ||
      !clean(p.workflowName) || !clean(p.jobName))
    throw Error('Invalid Codex policy repository, branch, or workflow');
  if (!Array.isArray(p.trustedPrActors) || p.trustedPrActors.length < 1 ||
      p.trustedPrActors.length > 8 ||
      p.trustedPrActors.some(x => !clean(x) || x.length > 50) ||
      new Set(p.trustedPrActors).size !== p.trustedPrActors.length ||
      !p.trustedPrActors.includes(p.owner))
    throw Error('Invalid trusted Codex PR actors');
  if (!Array.isArray(p.authors) || p.authors.length < 1 || p.authors.length > 16)
    throw Error('Invalid Codex author registry');
  const ids = new Set(), aliases = new Map(), bindings = new Set();
  const authors = p.authors.map(author => {
    if (!author || typeof author !== 'object' || Array.isArray(author) ||
        Object.keys(author).some(k=>!['id','name','aliases','fingerprint',
          'binding','sessionObservation'].includes(k)) ||
        !/^[a-z][a-z0-9-]{2,63}$/.test(author.id || '') ||
        !clean(author.name) || !/^[a-f0-9]{64}$/.test(author.fingerprint || '') ||
        !Array.isArray(author.aliases) || author.aliases.length > 12)
      throw Error('Invalid Codex author policy');
    if (ids.has(author.id)) throw Error('Duplicate Codex author');
    ids.add(author.id);
    const labels = [author.id, author.name, ...author.aliases];
    for (const label of labels) {
      if (!clean(label)) throw Error('Invalid Codex author alias');
      const normalized = label.trim().toLowerCase().replaceAll('’', "'");
      if (aliases.has(normalized) && aliases.get(normalized) !== author.id)
        throw Error('Ambiguous Codex author alias');
      aliases.set(normalized, author.id);
    }
    const binding = author.binding;
    if (binding !== null && binding !== undefined) {
      if (typeof binding !== 'object' || Array.isArray(binding) ||
          !['enrolled','not-enrolled'].includes(binding.status) ||
          (binding.status === 'enrolled' && !/^[a-f0-9]{64}$/.test(binding.fingerprint || '')))
        throw Error('Invalid Codex author binding');
      if (binding.status === 'enrolled') {
        if (bindings.has(binding.fingerprint)) throw Error('Duplicate Codex route binding');
        bindings.add(binding.fingerprint);
      }
    }
    return Object.freeze({...author,
      aliases:Object.freeze([...author.aliases]),
      binding:binding && Object.freeze({...binding})});
  });
  return Object.freeze({...p,
    trustedPrActors:Object.freeze([...p.trustedPrActors]),
    authors:Object.freeze(authors)});
}
export const DEFAULT_CODEX_POLICY = createCodexPolicy();

const validTime = value => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function buildCodexCall({ issueNumber, objective, sourceSha,
  policy = DEFAULT_CODEX_POLICY }) {
  policy = createCodexPolicy(policy);
  const parsed = parseCodexObjective(objective, { authors: policy.authors });
  if (!parsed || !validNumber(issueNumber) || !SHA.test(sourceSha || '') ||
      objective.includes(CODEX_CALL_MARKER)) throw Error('Invalid Codex call request');
  const author = parsed.author;
  const taskId = 'ucc-' + hash(JSON.stringify([policy.repository, issueNumber,
    sourceSha, author.id, author.binding.fingerprint, objective])).slice(0, 24);
  const call = { schema: 'ultron.codex.call.v1', repository: policy.repository,
    taskId, issueNumber, authorId: author.id, authorFingerprint: author.fingerprint,
    bindingFingerprint: author.binding.fingerprint, sourceSha,
    request: objective, objective: parsed.objective };
  return Object.freeze({ ...call, digest: hash(JSON.stringify(call)) });
}

function validateCall(call, policy = DEFAULT_CODEX_POLICY) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) throw Error('Invalid Codex envelope');
  const expected = buildCodexCall({issueNumber: call.issueNumber, objective: call.request,
    sourceSha: call.sourceSha, policy});
  if (Object.keys(call).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key => call[key] !== expected[key]))
    throw Error('Codex envelope identity or digest mismatch');
  return expected;
}

export function formatCodexCall(call, policy = DEFAULT_CODEX_POLICY) {
  return '<!-- ' + CODEX_CALL_MARKER + '\n' + JSON.stringify(validateCall(call, policy))
    .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e') + '\n-->';
}

export function parseCodexCall(body, policy = DEFAULT_CODEX_POLICY) {
  if (typeof body !== 'string' || body.length > 30000 ||
      body.split(CODEX_CALL_MARKER).length !== 2) throw Error('Missing or duplicate Codex envelope');
  const match = /<!-- ULTRON_CODEX_CALL_V1\n([^\n]+)\n-->/.exec(body);
  if (!match) throw Error('Malformed Codex envelope');
  let value;
  try { value = JSON.parse(match[1]); } catch { throw Error('Malformed Codex envelope JSON'); }
  // Requiring canonical bytes also rejects duplicate JSON keys and hidden extra fields.
  const call = validateCall(value, policy);
  if (match[0] !== formatCodexCall(call, policy)) throw Error('Noncanonical Codex envelope');
  return call;
}

export function validateCodexAdmission({ pr, issue, mainSha, bindingFingerprint,
  proposalText, policy = DEFAULT_CODEX_POLICY }) {
  policy = createCodexPolicy(policy);
  const call = parseCodexCall(pr?.body, policy);
  if (mainSha !== call.sourceSha || bindingFingerprint !== call.bindingFingerprint)
    throw Error('Codex source or installed binding changed');
  if (!validNumber(pr?.number) || pr.state !== 'open' || pr.merged === true ||
      !policy.trustedPrActors.includes(pr.user?.login) ||
      pr.title !== policy.prTitlePrefix + call.authorId + ' · issue ' + call.issueNumber ||
      pr.head?.ref !== policy.branchPrefix + call.issueNumber || !SHA.test(pr.head?.sha || '') ||
      pr.head?.repo?.full_name !== policy.repository || pr.base?.ref !== policy.baseBranch ||
      pr.base?.repo?.full_name !== policy.repository)
    throw Error('Codex PR provenance mismatch');
  if (issue?.number !== call.issueNumber || issue.state !== 'open' || issue.pull_request ||
      issue.user?.login !== policy.owner || issue.title !== policy.issueTitle ||
      issue.body !== policy.issueMarker + '\n' + call.request)
    throw Error('Codex owner request changed or is untrusted');
  if (parseCodexCall(proposalText, policy).digest !== call.digest)
    throw Error('Codex proposal envelope mismatch');
  return call;
}

export function codexRecordPaths(call, policy = DEFAULT_CODEX_POLICY) {
  validateCall(call, policy);
  return Object.freeze({ claim: 'docs/codex/claims/' + call.taskId + '.json',
    receipt: 'docs/codex/receipts/' + call.taskId + '.json' });
}

export function buildCodexClaim(call, { headSha, claimedAt = new Date().toISOString() },
  policy = DEFAULT_CODEX_POLICY) {
  validateCall(call, policy);
  if (!SHA.test(headSha || '') || !validTime(claimedAt)) throw Error('Invalid Codex claim provenance');
  return Object.freeze({ schema: 'ultron.codex.claim.v1', taskId: call.taskId,
    taskDigest: call.digest, authorId: call.authorId, bindingFingerprint: call.bindingFingerprint,
    sourceSha: call.sourceSha, headSha, claimedAt, status: 'claimed', attempts: 1 });
}

export function buildCodexReceipt(call, { headSha, claimHeadSha,
  completedAt = new Date().toISOString(), result }, policy = DEFAULT_CODEX_POLICY) {
  validateCall(call, policy);
  if (!SHA.test(headSha || '') || !SHA.test(claimHeadSha || '') || !validTime(completedAt) ||
      typeof result !== 'string' || !result.trim() || result.length > 2000 ||
      /[\u0000-\u001f\u007f]/.test(result)) throw Error('Invalid Codex completion evidence');
  return Object.freeze({ schema: 'ultron.codex.receipt.v1', taskId: call.taskId,
    taskDigest: call.digest, authorId: call.authorId, authorFingerprint: call.authorFingerprint,
    bindingFingerprint: call.bindingFingerprint, sourceSha: call.sourceSha,
    headSha, claimHeadSha, completedAt, status: 'completed', result,
    identityEvidence: 'work-enrollment-not-account-attestation' });
}

export function validateCodexReceipt(receipt, call, policy = DEFAULT_CODEX_POLICY) {
  const expected = buildCodexReceipt(call, receipt || {}, policy);
  if (!receipt || Object.keys(receipt).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key => receipt[key] !== expected[key]))
    throw Error('Codex receipt does not match the called author and task');
  return expected;
}

/** Schema and identity only; Git ancestry must be verified separately. */
export function validateCodexClaim(claim, call, policy = DEFAULT_CODEX_POLICY) {
  validateCall(call, policy);
  const keys='attempts,authorId,bindingFingerprint,claimedAt,headSha,schema,sourceSha,status,taskDigest,taskId';
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
      Object.keys(claim).sort().join(',') !== keys ||
      claim.schema !== 'ultron.codex.claim.v1' ||
      claim.taskId !== call.taskId || claim.taskDigest !== call.digest ||
      claim.authorId !== call.authorId ||
      claim.bindingFingerprint !== call.bindingFingerprint ||
      claim.sourceSha !== call.sourceSha ||
      !SHA.test(claim.headSha || '') || !validTime(claim.claimedAt) ||
      claim.status !== 'claimed' || claim.attempts !== 1)
    throw Error('Invalid or conflicting Codex claim; reconcile before replay');
  return Object.freeze({ ...claim });
}

export function codexReplayDisposition(call, records = {}, policy = DEFAULT_CODEX_POLICY) {
  validateCall(call, policy);
  if (Object.hasOwn(records, 'receipt')) {
    validateCodexReceipt(records.receipt, call, policy);
    if (!Object.hasOwn(records, 'claim'))
      throw Error('Completion receipt without earlier claim is not sufficient');
    const claim = validateCodexClaim(records.claim, call, policy);
    if (Date.parse(records.receipt.completedAt) < Date.parse(claim.claimedAt))
      throw Error('Completion receipt predates its claim');
    return 'already-completed';
  }
  return Object.hasOwn(records, 'claim') ? 'reconcile-required' : 'unclaimed';
}
