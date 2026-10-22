import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPrUrl } from '../docs/core/cloud-pr-submit.mjs';
import { parsePrRequest, PR_OWNER, PR_REPOSITORY, PR_MARKER, PR_ISSUE_TITLE } from '../src/cloud-pr.mjs';
import { CODEX_AUTHORS, resolveCodexAuthor, parseCodexObjective } from '../docs/core/codex-authors.mjs';
import { buildCodexCall, formatCodexCall, parseCodexCall, validateCodexAdmission,
  buildCodexClaim, buildCodexReceipt, validateCodexReceipt, codexReplayDisposition,
  codexRecordPaths } from '../src/codex-call.mjs';
import { createHash } from 'node:crypto';

const BASE = 'a'.repeat(40), HEAD = 'b'.repeat(40), CLAIM = 'c'.repeat(40);
const call = () => buildCodexCall({ issueNumber: 101, sourceSha: BASE,
  objective: '/codex destiny-codex Inspect README.md' });
const admission = () => {
  const task = call();
  return { mainSha: BASE, bindingFingerprint: task.bindingFingerprint,
    proposalText: formatCodexCall(task),
    pr: { number: 102, state: 'open', user: { login: 'github-actions[bot]' },
      title: '[Ultron Codex] destiny-codex · issue 101', body: formatCodexCall(task),
      head: { ref: 'ultron/issue-101', sha: HEAD, repo: { full_name: PR_REPOSITORY } },
      base: { ref: 'main', repo: { full_name: PR_REPOSITORY } } },
    issue: { number: 101, state: 'open', user: { login: PR_OWNER },
      title: PR_ISSUE_TITLE, body: PR_MARKER + '\n' + task.request } };
};

test('unbound named author cannot publish a task or fall back to another executor', () => {
  assert.throws(() => createCloudPrUrl('/codex mike-codex Inspect README.md'), /not bound/i);
});

test('unknown named author cannot silently become an ordinary proposal', () => {
  assert.throws(() => createCloudPrUrl('/codex somebody Inspect README.md'), /Unknown Codex author/);
});

test('named owner request chooses the author in the actual PR routing contract', () => {
  const objective = '/codex destiny-codex Inspect README.md';
  const event = { action: 'opened', issue: { number: 101, state: 'open',
    user: { login: PR_OWNER }, title: PR_ISSUE_TITLE, body: PR_MARKER + '\n' + objective } };
  const result = parsePrRequest(event, PR_OWNER, PR_REPOSITORY);
  assert.equal(result.codex?.author.id, 'destiny-codex');
  assert.equal(result.title, '[Ultron Codex] destiny-codex · issue 101');
});

test('two stable author fingerprints resolve aliases without claiming account identity', () => {
  assert.deepEqual(CODEX_AUTHORS.map(a => a.name), ["Mike's Codex", "Destiny's Codex"]);
  for (const author of CODEX_AUTHORS) {
    assert.equal(author.fingerprint, createHash('sha256')
      .update('ultron:codex-author:v1:' + author.id).digest('hex'));
    for (const alias of [...author.aliases, author.id, author.name.toUpperCase()])
      assert.equal(resolveCodexAuthor(alias), author);
  }
  assert.equal(resolveCodexAuthor('Destiny’s Codex').id, 'destiny-codex');
  assert.equal(CODEX_AUTHORS[1].sessionObservation.accountAuthenticated, false);
  assert.equal(parseCodexObjective('Please ask Destiny about a task'), null);
  for (const input of ['/codex', '/codex destiny-codex', '/codex destiny-codex x\ny',
    '/codex destiny-codex  x', '/codex destiny-codex x ', '/codex run x'])
    assert.throws(() => parseCodexObjective(input));
});

test('canonical envelope rejects author swaps, duplicates, hidden keys and tampered digests', () => {
  const task = call(), body = formatCodexCall(task);
  assert.deepEqual(parseCodexCall(body), task);
  for (const changed of [body + body, body.replace('destiny-codex', 'mike-codex'),
    body.replace(task.digest, 'f'.repeat(64)), body.replace('Inspect README.md', 'Change README.md'),
    body.replace('{"schema":', '{"extra":true,"schema":'),
    body.replace('{"schema":', '{"schema":"ultron.codex.call.v1","schema":')])
    assert.throws(() => parseCodexCall(changed));
  const html = buildCodexCall({ issueNumber: 102, sourceSha: BASE,
    objective: '/codex destiny-codex Inspect <!-- x --> text' });
  assert.deepEqual(parseCodexCall(formatCodexCall(html)), html);
});

test('admission verifies source, bound lane, owner Issue, PR provenance and proposal agreement', () => {
  assert.deepEqual(validateCodexAdmission(admission()), call());
  const edits = [
    a => { a.mainSha = HEAD; }, a => { a.bindingFingerprint = 'f'.repeat(64); },
    a => { a.issue.body += ' changed'; }, a => { a.issue.user.login = 'outsider'; },
    a => { a.issue.state = 'closed'; }, a => { a.pr.head.repo.full_name = 'fork/repo'; },
    a => { a.pr.base.ref = 'other'; }, a => { a.pr.head.ref = 'unrelated'; },
    a => { a.pr.title = '[Ultron Codex] mike-codex · issue 101'; },
    a => { a.pr.user.login = 'outsider'; }, a => { a.pr.state = 'closed'; },
    a => { a.proposalText = 'missing'; }, a => { a.pr.merged = true; },
  ];
  for (const edit of edits) { const input = admission(); edit(input);
    assert.throws(() => validateCodexAdmission(input)); }
});

test('claims stop replay and completion receipts remain bound to author, task and source', () => {
  const task = call(), claim = buildCodexClaim(task, {headSha: HEAD});
  assert.equal(codexReplayDisposition(task), 'unclaimed');
  assert.equal(codexReplayDisposition(task, {claim}), 'reconcile-required');
  const receipt = buildCodexReceipt(task, {headSha: HEAD, claimHeadSha: CLAIM,
    result: 'README.md inspected successfully.'});
  assert.deepEqual(validateCodexReceipt(receipt, task), receipt);
  assert.equal(codexReplayDisposition(task, {claim, receipt}), 'already-completed');
  for (const edit of [{ authorId: 'mike-codex' }, { taskDigest: 'f'.repeat(64) },
    { sourceSha: HEAD }, { status: 'queued' }, { extra: true }, { completedAt: 'bad' }])
    assert.throws(() => validateCodexReceipt({...receipt, ...edit}, task));
  assert.throws(() => buildCodexReceipt(task, {headSha: HEAD, claimHeadSha: CLAIM, result: ''}));
  assert.throws(() => buildCodexClaim(task, {headSha: 'main'}));
  assert.match(codexRecordPaths(task).receipt, /^docs\/codex\/receipts\/ucc-[a-f0-9]{24}\.json$/);
});

test('present malformed durable records never become permission for a fresh attempt', () => {
  for (const value of [null, false, 0, '', {}, []]) {
    assert.equal(codexReplayDisposition(call(), { claim: value }), 'reconcile-required');
    assert.throws(() => codexReplayDisposition(call(), { receipt: value }));
  }
});
