import { createHash } from 'node:crypto';
import { parseCodexObjective } from '../docs/core/codex-authors.mjs';

export const CODEX_REPOSITORY = 'michaeljwilliams0123/Ultron.MW';
export const CODEX_OWNER = 'michaeljwilliams0123';
export const CODEX_CALL_MARKER = 'ULTRON_CODEX_CALL_V1';
const SHA = /^[a-f0-9]{40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const validNumber = value => Number.isSafeInteger(value) && value > 0;
const validTime = value => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function buildCodexCall({ issueNumber, objective, sourceSha }) {
  const parsed = parseCodexObjective(objective);
  if (!parsed || !validNumber(issueNumber) || !SHA.test(sourceSha || '') ||
      objective.includes(CODEX_CALL_MARKER)) throw Error('Invalid Codex call request');
  const author = parsed.author;
  const taskId = 'ucc-' + hash(JSON.stringify([CODEX_REPOSITORY, issueNumber,
    sourceSha, author.id, author.binding.fingerprint, objective])).slice(0, 24);
  const call = { schema: 'ultron.codex.call.v1', repository: CODEX_REPOSITORY,
    taskId, issueNumber, authorId: author.id, authorFingerprint: author.fingerprint,
    bindingFingerprint: author.binding.fingerprint, sourceSha,
    request: objective, objective: parsed.objective };
  return Object.freeze({ ...call, digest: hash(JSON.stringify(call)) });
}

function validateCall(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) throw Error('Invalid Codex envelope');
  const expected = buildCodexCall({issueNumber: call.issueNumber, objective: call.request,
    sourceSha: call.sourceSha});
  if (Object.keys(call).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key => call[key] !== expected[key]))
    throw Error('Codex envelope identity or digest mismatch');
  return expected;
}

export function formatCodexCall(call) {
  return '<!-- ' + CODEX_CALL_MARKER + '\n' + JSON.stringify(validateCall(call))
    .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e') + '\n-->';
}

export function parseCodexCall(body) {
  if (typeof body !== 'string' || body.length > 30000 ||
      body.split(CODEX_CALL_MARKER).length !== 2) throw Error('Missing or duplicate Codex envelope');
  const match = /<!-- ULTRON_CODEX_CALL_V1\n([^\n]+)\n-->/.exec(body);
  if (!match) throw Error('Malformed Codex envelope');
  let value;
  try { value = JSON.parse(match[1]); } catch { throw Error('Malformed Codex envelope JSON'); }
  // Requiring canonical bytes also rejects duplicate JSON keys and hidden extra fields.
  const call = validateCall(value);
  if (match[0] !== formatCodexCall(call)) throw Error('Noncanonical Codex envelope');
  return call;
}

export function validateCodexAdmission({ pr, issue, mainSha, bindingFingerprint, proposalText }) {
  const call = parseCodexCall(pr?.body);
  if (mainSha !== call.sourceSha || bindingFingerprint !== call.bindingFingerprint)
    throw Error('Codex source or installed binding changed');
  if (!validNumber(pr?.number) || pr.state !== 'open' || pr.merged === true ||
      ![CODEX_OWNER, 'github-actions[bot]'].includes(pr.user?.login) ||
      pr.title !== '[Ultron Codex] ' + call.authorId + ' · issue ' + call.issueNumber ||
      pr.head?.ref !== 'ultron/issue-' + call.issueNumber || !SHA.test(pr.head?.sha || '') ||
      pr.head?.repo?.full_name !== CODEX_REPOSITORY || pr.base?.ref !== 'main' ||
      pr.base?.repo?.full_name !== CODEX_REPOSITORY)
    throw Error('Codex PR provenance mismatch');
  if (issue?.number !== call.issueNumber || issue.state !== 'open' || issue.pull_request ||
      issue.user?.login !== CODEX_OWNER || issue.title !== '[Ultron PR] Create proposal' ||
      issue.body !== 'ULTRON_PR_V1\n' + call.request)
    throw Error('Codex owner request changed or is untrusted');
  if (parseCodexCall(proposalText).digest !== call.digest)
    throw Error('Codex proposal envelope mismatch');
  return call;
}

export function codexRecordPaths(call) {
  validateCall(call);
  return Object.freeze({ claim: 'docs/codex/claims/' + call.taskId + '.json',
    receipt: 'docs/codex/receipts/' + call.taskId + '.json' });
}

export function buildCodexClaim(call, { headSha, claimedAt = new Date().toISOString() }) {
  validateCall(call);
  if (!SHA.test(headSha || '') || !validTime(claimedAt)) throw Error('Invalid Codex claim provenance');
  return Object.freeze({ schema: 'ultron.codex.claim.v1', taskId: call.taskId,
    taskDigest: call.digest, authorId: call.authorId, bindingFingerprint: call.bindingFingerprint,
    sourceSha: call.sourceSha, headSha, claimedAt, status: 'claimed', attempts: 1 });
}

export function buildCodexReceipt(call, { headSha, claimHeadSha,
  completedAt = new Date().toISOString(), result }) {
  validateCall(call);
  if (!SHA.test(headSha || '') || !SHA.test(claimHeadSha || '') || !validTime(completedAt) ||
      typeof result !== 'string' || !result.trim() || result.length > 2000 ||
      /[\u0000-\u001f\u007f]/.test(result)) throw Error('Invalid Codex completion evidence');
  return Object.freeze({ schema: 'ultron.codex.receipt.v1', taskId: call.taskId,
    taskDigest: call.digest, authorId: call.authorId, authorFingerprint: call.authorFingerprint,
    bindingFingerprint: call.bindingFingerprint, sourceSha: call.sourceSha,
    headSha, claimHeadSha, completedAt, status: 'completed', result,
    identityEvidence: 'work-enrollment-not-account-attestation' });
}

export function validateCodexReceipt(receipt, call) {
  const expected = buildCodexReceipt(call, receipt || {});
  if (!receipt || Object.keys(receipt).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key => receipt[key] !== expected[key]))
    throw Error('Codex receipt does not match the called author and task');
  return expected;
}

export function codexReplayDisposition(call, records = {}) {
  validateCall(call);
  if (Object.hasOwn(records, 'receipt')) {
    validateCodexReceipt(records.receipt, call);
    return 'already-completed';
  }
  return Object.hasOwn(records, 'claim') ? 'reconcile-required' : 'unclaimed';
}
