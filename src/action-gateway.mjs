import { createHash, randomUUID, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const REPO = 'michaeljwilliams0123/Ultron.MW';
const PREFIX = 'ultron/action-notes/';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_OUTPUT = 512000;
const OWNER = 'michaeljwilliams0123';

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function validateAction(raw) {
  if (!raw || !['local-note', 'github-draft'].includes(raw.kind) ||
      !ID_PATTERN.test(raw.id || '') ||
      typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100 ||
      typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 1200 ||
      /[\u0000-\u001f<>]/.test(raw.title)) {
    throw invalid('Expected a valid action ID, kind, title and note text.');
  }
  return { kind: raw.kind, id: raw.id, title: raw.title.trim(), text: raw.text.trim() };
}

export function keyIsValid(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function makeSessionKey() {
  return randomBytes(24).toString('base64url');
}

/** A fixed command, not a shell interpreter; never passes dynamic command names. */
export function ghApi(endpoint, { method = 'GET', data } = {}) {
  const allowed = [
    'user',
    'repos/' + REPO,
    'repos/' + REPO + '/git/ref/heads/main',
    'repos/' + REPO + '/git/refs',
    'repos/' + REPO + '/pulls',
  ];
  const isDocument = /^repos\/michaeljwilliams0123\/Ultron\.MW\/contents\/docs\/owner-notes\/[0-9a-f-]{36}\.md(?:\?ref=ultron%2Faction-notes%2F[0-9a-f-]{36})?$/.test(endpoint);
  const isPull = /^repos\/michaeljwilliams0123\/Ultron\.MW\/pulls\/\d+$/.test(endpoint);
  if (![...allowed].includes(endpoint) && !isDocument && !isPull) throw invalid('GitHub API path not allowed', 403);
  if (!['GET', 'POST', 'PUT'].includes(method) ||
      (method === 'POST' && !['repos/' + REPO + '/git/refs','repos/' + REPO + '/pulls'].includes(endpoint)) ||
      (method === 'PUT' && !isDocument)) throw invalid('GitHub mutation outside allowed action');
  return new Promise((ok, fail) => {
    const args = ['api', endpoint, '-X', method, '-H', 'Accept:application/vnd.github+json'];
    if (data !== undefined) args.push('--input', '-');
    const child = spawn('gh', args, {
      shell: false, windowsHide: true,
      stdio: ['pipe','pipe','ignore'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    let output = '', finished = false;
    const timer = setTimeout(() => child.kill(), 20000);
    const reject = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fail(invalid('GitHub operation could not be confirmed; inspect remote state before retrying.', 502));
    };
    child.on('error', reject);
    child.stdout.on('data', c => {
      output += c.toString('utf8');
      if (output.length > MAX_OUTPUT) child.kill();
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0 || output.length > MAX_OUTPUT) {
        fail(invalid('GitHub operation could not be confirmed; inspect remote state before retrying.', 502));
        return;
      }
      try { ok(JSON.parse(output)); }
      catch { fail(invalid('GitHub response was not valid JSON.', 502)); }
    });
    child.stdin.on('error', reject);
    child.stdin.end(data === undefined ? undefined : JSON.stringify(data));
  });
}

export function createActionGateway({ root, api = ghApi } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('Expected absolute project root');
  const noteDirectory = resolve(root, '.local', 'action-notes');
  const digest = text => createHash('sha256').update(text).digest('hex');

  async function identity() {
    const user = await api('user');
    if (user?.login?.toLowerCase() !== OWNER) throw invalid('Current GitHub identity is not the configured owner.', 403);
    const repo = await api('repos/' + REPO);
    if (repo?.full_name !== REPO || repo?.default_branch !== 'main')
      throw invalid('Repository identity does not match configuration.', 409);
    return { account: user.login, repo: REPO };
  }

  async function localNote(input) {
    const job = validateAction(input);
    if (job.kind !== 'local-note') throw invalid('Wrong action type');
    await mkdir(noteDirectory, { recursive: true, mode: 0o700 });
    const pathRoot = await realpath(noteDirectory);
    if (pathRoot !== noteDirectory) throw invalid('Action directory was redirected.', 403);
    const destination = join(pathRoot, job.id + '.md');
    const content = '# ' + job.title + '\n\n' + job.text + '\n';
    await writeFile(destination, content, { flag: 'wx', mode: 0o600 });
    const found = await readFile(destination, 'utf8');
    if (found !== content) throw invalid('Local note content verification failed.', 502);
    return { kind: 'local-note', verified: true,
      file: '.local/action-notes/' + job.id + '.md',
      sha256: digest(found), bytes: Buffer.byteLength(found),
      evidence: 'File created exclusively and read back with matching bytes' };
  }

  async function githubDraft(input) {
    const job = validateAction(input);
    if (job.kind !== 'github-draft') throw invalid('Wrong action type');
    await identity();
    const ref = await api('repos/' + REPO + '/git/ref/heads/main');
    const baseSha = ref?.object?.sha;
    if (!SHA_PATTERN.test(baseSha || '')) throw invalid('Exact main SHA not verified', 502);
    const branch = PREFIX + job.id;
    const path = 'docs/owner-notes/' + job.id + '.md';
    const content = '# ' + job.title + '\n\n' + job.text + '\n';
    await api('repos/' + REPO + '/git/refs', { method: 'POST',
      data: { ref: 'refs/heads/' + branch, sha: baseSha } });
    const uploaded = await api('repos/' + REPO + '/contents/' + path, {
      method: 'PUT', data: { message: 'docs: record owner-confirmed Ultron note', branch,
        content: Buffer.from(content).toString('base64') },
    });
    if (!SHA_PATTERN.test(uploaded?.content?.sha || ''))
      throw invalid('GitHub document creation not confirmed', 502);
    const pr = await api('repos/' + REPO + '/pulls', {
      method: 'POST', data: {
        title: 'docs: ' + job.title, head: branch, base: 'main', draft: true,
        body: 'Owner-confirmed Ultron note. Exact source main: ' + baseSha +
          '. Documentation only; no merge or deployment requested.',
      },
    });
    if (!Number.isInteger(pr?.number) || pr.number < 1)
      throw invalid('Draft pull request was not confirmed', 502);
    const confirmedPR = await api('repos/' + REPO + '/pulls/' + pr.number);
    const recorded = await api('repos/' + REPO + '/contents/' + path +
      '?ref=' + encodeURIComponent(branch));
    const readBack = Buffer.from(String(recorded?.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
    if (confirmedPR?.draft !== true || confirmedPR?.head?.ref !== branch ||
        confirmedPR?.base?.ref !== 'main' || readBack !== content) {
      throw invalid('GitHub draft postconditions failed: reconciliation required', 502);
    }
    return { kind: 'github-draft', verified: true, branch, baseSha,
      number: pr.number, url: 'https://github.com/' + REPO + '/pull/' + pr.number,
      path, sha256: digest(readBack), evidence: 'Draft PR and file independently reread' };
  }

  return { identity, localNote, githubDraft };
}
