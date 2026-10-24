import { createHash } from 'node:crypto';

export const MAHORAGA_REPOSITORY = 'michaeljwilliams0123/mahoraga';
const SHA = /^[a-f0-9]{40}$/;
const REF = /^mahoraga\/[a-z0-9][a-z0-9._-]{2,79}$/;
const KEY = /^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const marker = key => `<!-- ULTRON_MAHORAGA_CONTROL_V1 ${key} -->`;

function requireSha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw Error('Exact SHA required');
  return value;
}

function issueInput(input, idempotencyKey) {
  if (!input || !KEY.test(idempotencyKey || '') ||
      typeof input.title !== 'string' || input.title.length < 1 ||
      input.title.length > 160 || typeof input.body !== 'string' ||
      input.body.length < 1 || input.body.length > 12000 ||
      input.body.includes('ULTRON_MAHORAGA_CONTROL_V1'))
    throw Error('Bounded Mahoraga issue request required');
  return { title: input.title, body: input.body + '\n\n' + marker(idempotencyKey),
    expectedMainSha: requireSha(input.expectedMainSha) };
}

function dispatchInput(input) {
  if (!input || typeof input.ref !== 'string' || !REF.test(input.ref))
    throw Error('Bounded Mahoraga branch required');
  return { ref: input.ref, expectedHeadSha: requireSha(input.expectedHeadSha) };
}

/**
 * This adapter uses a Mahoraga-only GitHub App operator. It never receives an
 * Ultron repository token or a caller-selected repository/API path. Broker
 * authorization, identity, expiry, cost and idempotency checks precede writes.
 */
export function createMahoragaControlAdapter({ operator, repositoryId } = {}) {
  if (!operator || typeof operator.request !== 'function' ||
      !Number.isSafeInteger(repositoryId) || repositoryId < 1)
    throw Error('Mahoraga installation operator required');
  const results = new Map();
  const get = (path, permission) => operator.request({ path, permission });
  const post = (path, permission, body) => operator.request({
    method: 'POST', path, permission, body,
  });

  async function repository() {
    const repo = await get('/', 'contents:read');
    if (repo?.id !== repositoryId || repo?.full_name !== MAHORAGA_REPOSITORY ||
        repo?.private !== true || repo?.default_branch !== 'main')
      throw Error('Mahoraga repository identity mismatch');
    return repo;
  }

  async function head(ref = 'main') {
    const value = await get('/git/ref/heads/' + ref, 'contents:read');
    return requireSha(value?.object?.sha);
  }

  async function findIssue(key) {
    const tag = marker(key);
    let found = null;
    for (let page = 1; page <= 10; page++) {
      const items = await get(`/issues?state=all&per_page=100&page=${page}`, 'issues:write');
      if (!Array.isArray(items) || items.length > 100)
        throw Error('Mahoraga issue readback invalid');
      const matches = items.filter(item => !item.pull_request &&
        typeof item.body === 'string' && item.body.includes(tag));
      if (matches.length > 1 || found && matches.length)
        throw Error('Mahoraga issue marker collision');
      if (matches.length === 1) found = matches[0];
      if (items.length < 100) return found;
    }
    throw Error('Mahoraga issue reconciliation exceeds bounded window');
  }

  async function findDispatch(expectedHeadSha) {
    const runs = await get('/actions/workflows/verify.yml/runs?event=workflow_dispatch&head_sha=' +
      expectedHeadSha + '&per_page=100', 'actions:write');
    if (!Array.isArray(runs?.workflow_runs)) throw Error('Mahoraga run readback invalid');
    return runs.workflow_runs.find(run => run.head_sha === expectedHeadSha &&
      run.event === 'workflow_dispatch' && run.path === '.github/workflows/verify.yml') || null;
  }

  async function health({ binding }) {
    await repository();
    await head();
    // GET requests prove that the issued installation token contains BOTH
    // write grants without changing the target repository.
    await get('/issues?per_page=1', 'issues:write');
    await get('/actions/workflows/verify.yml', 'actions:write');
    return { status: 'ready', actorRef: binding.actorRef,
      grantedScopes: ['mahoraga.issue.create', 'mahoraga.workflow.dispatch'] };
  }

  async function execute({ operation, input, idempotencyKey }) {
    await repository();
    let result;
    if (operation === 'mahoraga.issue.create') {
      const proposal = issueInput(input, idempotencyKey);
      let item = await findIssue(idempotencyKey);
      const adopted = !!item;
      if (item && (item.title !== proposal.title || item.body !== proposal.body))
        throw Error('Mahoraga idempotency key reused with different issue');
      if (!item) {
        if (await head() !== proposal.expectedMainSha) throw Error('Mahoraga main moved');
        item = await post('/issues', 'issues:write', {
          title: proposal.title, body: proposal.body,
        });
      }
      if (!Number.isSafeInteger(item?.number) || item.number < 1)
        throw Error('Mahoraga issue response invalid');
      const observed = await get('/issues/' + item.number, 'issues:write');
      if (observed?.number !== item.number || observed?.title !== proposal.title ||
          observed?.body !== proposal.body || observed?.pull_request)
        throw Error('Mahoraga issue postcondition unverified');
      result = { kind: 'issue', number: item.number, key: idempotencyKey,
        title: proposal.title, bodyDigest: digest(proposal.body), adopted };
    } else if (operation === 'mahoraga.workflow.dispatch') {
      const proposal = dispatchInput(input);
      let run = await findDispatch(proposal.expectedHeadSha);
      const adopted = !!run;
      if (!run) {
        if (await head(proposal.ref) !== proposal.expectedHeadSha)
          throw Error('Mahoraga branch moved');
        await post('/actions/workflows/verify.yml/dispatches', 'actions:write',
          { ref: proposal.ref });
        for (let attempt = 0; attempt < 3 && !run; attempt++)
          run = await findDispatch(proposal.expectedHeadSha);
      }
      if (!Number.isSafeInteger(run?.id) || run.id < 1)
        throw Error('Mahoraga dispatch outcome requires reconciliation');
      result = { kind: 'verify', runId: run.id, ref: proposal.ref,
        headSha: proposal.expectedHeadSha, adopted };
    } else throw Error('Mahoraga operation not admitted');
    results.set(digest(result), result);
    return result;
  }

  async function observe({ query }) {
    const result = results.get(query?.resultDigest);
    if (!result) return { verified: false, reason: 'no-result-to-reconcile' };
    if (result.kind === 'issue') {
      const item = await get('/issues/' + result.number, 'issues:write');
      return { verified: query?.expected?.kind === 'issue' &&
        (query.expected.number === undefined || query.expected.number === result.number) &&
        item?.number === result.number &&
        item?.title === result.title && digest(item?.body) === result.bodyDigest &&
        item?.body?.includes(marker(result.key)) === true,
      kind: 'issue', number: result.number };
    }
    const run = await get('/actions/runs/' + result.runId, 'actions:write');
    return { verified: query?.expected?.kind === 'verify' &&
      (query.expected.headSha === undefined ||
        query.expected.headSha === result.headSha) &&
      run?.id === result.runId &&
      run?.head_sha === result.headSha && run?.event === 'workflow_dispatch' &&
      run?.path === '.github/workflows/verify.yml',
    kind: 'verify', runId: result.runId };
  }

  async function unbind() {
    // Local cache invalidation cannot revoke an already issued GitHub token.
    throw Error('Revoke the GitHub App installation grant at GitHub');
  }

  return Object.freeze({ health, execute, observe, unbind });
}
