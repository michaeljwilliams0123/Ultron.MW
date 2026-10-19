import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

const REPO = 'michaeljwilliams0123/Ultron.MW';
const OWNER = 'michaeljwilliams0123';
const BRANCH_RE = /^ultron\/notes\/[0-9a-f-]{36}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const NOTE_ID_RE = /^[0-9a-f-]{36}$/;

function error(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}
export function validateNote({ title, text } = {}) {
  if (typeof title !== 'string' || !title.trim() || title.length > 100 ||
      /[\r\n<>]/.test(title) || typeof text !== 'string' ||
      !text.trim() || text.length > 1200 ||
      /\b(private[_ -]?key|begin rsa|ghp_[a-z0-9]+|github_pat_[a-z0-9]+|password\s*[:=]|api[_ -]?key\s*[:=])\b/i.test(text)) {
    throw error('Note requires a short title and 1–1200 non-secret characters', 400);
  }
  return { title: title.trim(), text: text.trim() };
}
export function makeOwnerKey() {
  return randomBytes(24).toString('base64url');
}
export function ownerKeyMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' ||
      actual.length !== expected.length || !expected) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

// No dynamic shell commands. Existing operating-system GitHub login is used.
export async function runGhApi(endpoint, { method = 'GET', body } = {}) {
  if (!/^repos\/michaeljwilliams0123\/Ultron\.MW(?:\/[a-zA-Z0-9._/?=&%-]+)?$/.test(endpoint) &&
      endpoint !== 'user') throw error('Unapproved GitHub API path', 400);
  if (!['GET','POST','PUT'].includes(method)) throw error('Unapproved GitHub operation', 400);
  return new Promise((resolvePromise, reject) => {
    const args = ['api', endpoint, '-X', method, '-H', 'Accept:application/vnd.github+json'];
    if (body !== undefined) args.push('--input', '-');
    const child = spawn('gh', args, {
      shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    let output = '', settled = false;
    const deadline = setTimeout(() => child.kill(), 30000);
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error('Authenticated GitHub CLI action failed; verify login and reconcile remote state'));
    };
    child.on('error', fail);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 1024 * 1024) child.kill();
    });
    child.stderr.on('data', () => {});
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (code !== 0 || output.length > 1024 * 1024) {
        reject(error('GitHub action was not confirmed; reconcile rather than automatically retry'));
        return;
      }
      try { resolvePromise(JSON.parse(output)); }
      catch { reject(error('GitHub returned an invalid response')); }
    });
    if (body !== undefined) child.stdin.end(JSON.stringify(body));
    else child.stdin.end();
  });
}

export function createOwnerOperator({
  root, ownerKey = makeOwnerKey(), gh = runGhApi,
} = {}) {
  if (typeof root !== 'string' || !root) throw new Error('Root required');
  const privateRoot = resolve(root, '.local', 'owner-notes');
  const authorize = value => ownerKeyMatches(value, ownerKey);
  const digest = value => createHash('sha256').update(value).digest('hex');
  async function identity() {
    const user = await gh('user');
    if (user?.login?.toLowerCase() !== OWNER) throw error('Authenticated GitHub user does not match owner', 403);
    const repository = await gh('repos/' + REPO);
    if (repository?.full_name !== REPO || repository.default_branch !== 'main')
      throw error('GitHub repository authority has changed', 409);
    return { connected: true, account: user.login, repo: REPO };
  }
  async function createLocalNote(job) {
    const { title, text } = validateNote(job);
    if (!NOTE_ID_RE.test(job.id)) throw error('Invalid note identifier', 400);
    const file = job.id + '.md';
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const actualRoot = await realpath(privateRoot);
    if (actualRoot !== privateRoot) throw error('Workspace path redirected; refusing write', 403);
    const path = join(actualRoot, file);
    const rel = relative(actualRoot, path);
    if (isAbsolute(rel) || rel.startsWith('..')) throw error('Unsafe path', 403);
    const content = '# ' + title + '\n\n' + text + '\n';
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    const readBack = await readFile(path, 'utf8');
    if (readBack !== content) throw error('Workspace verification failed');
    return {
      status: 'verified', kind: 'workspace-note', path: '.local/owner-notes/' + file,
      sha256: digest(readBack), bytes: Buffer.byteLength(readBack),
      postcondition: 'Exactly one new local Markdown file reread with matching bytes',
    };
  }
  async function createGithubDraft(job) {
    const { title, text } = validateNote(job);
    if (!NOTE_ID_RE.test(job.id)) throw error('Invalid GitHub note ID', 400);
    const branch = 'ultron/notes/' + job.id;
    if (!BRANCH_RE.test(branch)) throw error('Invalid branch');
    const notePath = 'docs/agent-notes/' + job.id + '.md';
    await identity();
    const main = await gh('repos/' + REPO + '/git/ref/heads/main');
    const sha = main?.object?.sha;
    if (!SHA_RE.test(sha)) throw error('Unable to verify current main');
    const expected = '# ' + title + '\n\n' + text + '\n';
    await gh('repos/' + REPO + '/git/refs', {
      method: 'POST', body: { ref: 'refs/heads/' + branch, sha },
    });
    const written = await gh('repos/' + REPO + '/contents/' + notePath, {
      method: 'PUT',
      body: { message: 'docs: add Ultron owner note', branch,
        content: Buffer.from(expected).toString('base64') },
    });
    if (!SHA_RE.test(written?.content?.sha)) throw error('GitHub file write was not verified');
    const pr = await gh('repos/' + REPO + '/pulls', {
      method: 'POST', body: {
        title: 'docs: ' + title, head: branch, base: 'main', draft: true,
        body: 'Owner-directed documentation note generated by the local Ultron operator. Source SHA ' + sha + '. Draft PR only; no merge or deployment requested.',
      },
    });
    if (!Number.isInteger(pr?.number)) throw error('GitHub did not acknowledge draft PR');
    const confirmed = await gh('repos/' + REPO + '/pulls/' + pr.number);
    const file = await gh('repos/' + REPO + '/contents/' + notePath + '?ref=' + encodeURIComponent(branch));
    const decoded = Buffer.from((file?.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
    if (confirmed?.head?.ref !== branch || confirmed?.base?.ref !== 'main' ||
        confirmed?.draft !== true || decoded !== expected) {
      throw error('GitHub postconditions not verified; inspect remote branch/PR');
    }
    return {
      status: 'verified', kind: 'github-draft', branch, path: notePath, pr: pr.number,
      url: 'https://github.com/' + REPO + '/pull/' + pr.number,
      baseSha: sha, contentSha256: digest(decoded),
      postcondition: 'Exact-main branch, matching document, and draft PR reread from GitHub',
    };
  }
  return { authorize, identity, createLocalNote, createGithubDraft,
    ownerKey, repo: REPO };
}
