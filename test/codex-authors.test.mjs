import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPrUrl } from '../docs/core/cloud-pr-submit.mjs';
import { parsePrRequest, PR_OWNER, PR_REPOSITORY, PR_MARKER, PR_ISSUE_TITLE } from '../src/cloud-pr.mjs';
import { CODEX_AUTHORS, resolveCodexAuthor, parseCodexObjective,
  isCodexRunCommand, routeCodexObjective } from '../docs/core/codex-authors.mjs';
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

test('stable author fingerprints resolve aliases without claiming account identity', () => {
  assert.deepEqual(CODEX_AUTHORS.map(a => a.name), ["Mike's Codex", "Ultron's Codex"]);
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
  assert.throws(() => codexReplayDisposition(task, {receipt}), /without earlier claim/);
  assert.throws(() => codexReplayDisposition(task,
    {claim: {...claim, authorId:'mike-codex'}, receipt}), /Invalid or conflicting/);
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

test('Ultron and Destiny resolve to the same stable enrolled route', () => {
  assert.equal(resolveCodexAuthor('ultron-codex'), resolveCodexAuthor('destiny-codex'));
  assert.equal(resolveCodexAuthor('ultron').id, 'destiny-codex');
  assert.equal(resolveCodexAuthor('ultron').binding.status, 'enrolled');
  assert.equal(parseCodexObjective('/codex ultron-codex Inspect README.md').author.id, 'destiny-codex');
});

test('dedicated GitHub username calls the same executor without changing its stable identity', () => {
  const name = 'michaeljwilliams0123ultron';
  const author = resolveCodexAuthor(name, {requireBinding: true});
  assert.equal(author, resolveCodexAuthor('ultron-codex'));
  assert.equal(author.id, 'destiny-codex');
  const objective = '/codex ' + name + ' Inspect README.md';
  const task = buildCodexCall({issueNumber: 103, sourceSha: BASE, objective});
  assert.equal(task.authorId, 'destiny-codex');
  assert.equal(task.bindingFingerprint, author.binding.fingerprint);
  assert.deepEqual(parseCodexCall(formatCodexCall(task)), task);
  assert.equal(new URL(createCloudPrUrl(objective)).searchParams.get('body'), PR_MARKER + '\n' + objective);
});

test('explicit leading tags build the existing owner-confirmed call envelope', () => {
  for (const alias of ['ultron-codex', 'destiny-codex', 'michaeljwilliams0123ultron']) {
    const objective = '@' + alias + ' Inspect README.md';
    const author = parseCodexObjective(objective).author;
    assert.equal(author.id, 'destiny-codex');
    const task = buildCodexCall({issueNumber: 104, sourceSha: BASE, objective});
    assert.equal(task.authorId, author.id);
    assert.deepEqual(parseCodexCall(formatCodexCall(task)), task);
    assert.equal(new URL(createCloudPrUrl(objective)).searchParams.get('body'), PR_MARKER + '\n' + objective);
  }
  assert.equal(parseCodexObjective('Please ask @ultron-codex Inspect README.md'), null);
  assert.equal(parseCodexObjective('@unregistered Inspect README.md'), null);
  assert.throws(()=>parseCodexObjective('@mike-codex Inspect README.md'),/not bound/i);
  assert.throws(()=>createCloudPrUrl('@mike-codex Inspect README.md'),/not bound/i);
  for (const text of ['@ultron-codex', '@ultron-codex  task', '@ultron-codex task\nmore', '@ultron-codex task '])
    assert.throws(() => parseCodexObjective(text));
});

test('only documented exact bare tags count as owner PR triggers, never short aliases',()=>{
  for(const tag of ['@michaeljwilliams0123ultron','@ultron-codex','@destiny-codex'])
    assert.equal(isCodexRunCommand(tag,'destiny-codex'),true,tag);
  for(const tag of ['@ultron','@destiny','@mike-codex','@unregistered',
    '@ultron-codex do something','@ultron-codex ','@destiny-codex\n'])
    assert.equal(isCodexRunCommand(tag,'destiny-codex'),false,tag);
  assert.equal(isCodexRunCommand('/codex run ultron','destiny-codex'),true);
  assert.equal(isCodexRunCommand('/codex run mike-codex','destiny-codex'),false);
});

test('console Codex router preserves explicit registered tags and rejects unbound substitution',()=>{
  for(const tag of ['@michaeljwilliams0123ultron','@ultron-codex','@destiny-codex']){
    const objective=tag+' Inspect README.md';
    assert.equal(routeCodexObjective(objective,'mike-codex'),objective);
    assert.equal(routeCodexObjective(objective,'destiny-codex'),objective);
  }
  assert.equal(routeCodexObjective('/codex destiny-codex Inspect README.md','mike-codex'),
    '/codex destiny-codex Inspect README.md');
  assert.equal(routeCodexObjective('Inspect README.md','destiny-codex'),
    '/codex destiny-codex Inspect README.md');
  for(const input of ['@mike-codex Inspect README.md','@unknown Inspect README.md'])
    assert.throws(()=>routeCodexObjective(input,'destiny-codex'),/not bound|Unknown/i);
  assert.throws(()=>routeCodexObjective('Inspect README.md','mike-codex'),/not bound/i);
  assert.throws(()=>routeCodexObjective('@ultron-codex  Inspect README.md','destiny-codex'));
});

test('both mirrored consoles show named-call receipts and route explicit tags without selected-author prefix',async()=>{
  const {readFileSync}=await import('node:fs');
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const docs=read('docs/app.js');
  const mirror=read('cloud/hatchable/public/app.js');
  assert.equal(docs,mirror);
  assert.match(docs,/routeCodexObjective\(objective, \$\('codex-author'\)\.value\)/);
  assert.match(docs,/Boolean\(parseCodexObjective\(objective\)\)/);
  assert.match(docs,/\^@\(\?:michaeljwilliams0123ultron\|ultron-codex\|destiny-codex\)/);
  assert.doesNotMatch(docs,/routePrToGitHub\(\^\/codex\(\?:/);
});
