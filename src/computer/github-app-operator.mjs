import { createSign } from 'node:crypto';

/**
 * GitHub App installation credentials for unattended, owner-granted actions.
 * This is an APP identity, never a claim of having completed human MFA.
 * Credentials are supplied by a protected host and never written to Git.
 */
const PERMISSION = /^[a-z][a-z_]{1,49}$/;
const SLUG = /^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/;
const REQUEST_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const API = 'https://api.github.com';
const HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createGitHubAppJwt({ clientId, privateKey, now = Date.now() } = {}) {
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{3,120}$/.test(clientId) ||
      typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY') ||
      !Number.isFinite(now)) throw Error('GitHub App signing configuration invalid');
  const current = Math.floor(now / 1000);
  const value = b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({ iss: clientId, iat: current - 60, exp: current + 540 });
  const sign = createSign('RSA-SHA256');
  sign.update(value);
  sign.end();
  return value + '.' + sign.sign(privateKey).toString('base64url');
}

function normalizePermissions(permissions) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) ||
      Object.keys(permissions).length === 0 ||
      Object.entries(permissions).some(([key, value]) =>
        !PERMISSION.test(key) || !['read', 'write'].includes(value)))
    throw Error('Explicit bounded GitHub App permissions required');
  return Object.freeze({ ...permissions });
}

function safeRelativePath(path, repository) {
  if (typeof path !== 'string' || !path.startsWith('/') ||
      path.includes('#') || path.includes('\\') ||
      /%2f|%5c|%2e|%00/i.test(path)) throw Error('Noncanonical repository API path');
  if (path !== '/' && path.slice(1).split('/').some(part => part === '.' || part === '..' || part === '')) throw Error('Noncanonical repository API path');
  const url = new URL(API + '/repos/' + repository + (path === '/' ? '' : path));
  if (url.origin !== API || url.username || url.password ||
      !(url.pathname === '/repos/' + repository ||
        url.pathname.startsWith('/repos/' + repository + '/')) ||
      url.pathname.slice(1).split('/').slice(0,-1).some(part => part === '.' || part === '..' || part === ''))
    throw Error('Request must remain in the authorized repository');
  return url;
}
function statusOnly(value) {
  return Object.freeze({
    mode: 'github-app-installation',
    identity: 'app-not-human-user',
    expiresAt: value?.expiresAt || null,
    credentialsAvailable: !!value,
    tokenExposed: false,
  });
}
async function json(response) {
  try { return await response.json(); } catch { return null; }
}

/**
 * Requests are confined to ONE repository ID and current installation grants.
 * Writes are never retried after an ambiguous outcome; caller reconciles.
 * Application authority comes from GitHub, not the model's claimed identity.
 */
export function createGitHubAppOperator({
  clientId, installationId, repository, repositoryId, permissions,
  loadPrivateKey, transport = fetch, clock = () => Date.now(),
} = {}) {
  if (!SLUG.test(repository || '') || !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 || !Number.isSafeInteger(installationId) ||
      installationId < 1 || typeof loadPrivateKey !== 'function' ||
      typeof transport !== 'function' || typeof clock !== 'function')
    throw Error('Explicit GitHub App installation and repository identity required');
  const required = normalizePermissions(permissions);
  let current = null;
  let renewal = null;

  async function exchange() {
    const pem = await loadPrivateKey();
    const jwt = createGitHubAppJwt({ clientId, privateKey: pem, now: clock() });
    const response = await transport(API + '/app/installations/' +
      installationId + '/access_tokens', {
      method: 'POST', redirect: 'error',
      headers: { ...HEADERS, Authorization: 'Bearer ' + jwt,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ repository_ids: [repositoryId], permissions: required }),
    });
    if (!response?.ok) throw Error('GitHub App installation admission denied');
    const data = await json(response);
    const expiry = Date.parse(data?.expires_at || '');
    if (typeof data?.token !== 'string' || data.token.length < 16 ||
        !Number.isFinite(expiry) || expiry <= clock() + 60000 ||
        expiry > clock() + 3900000 ||
        !Array.isArray(data.repositories) ||
        data.repositories.length !== 1 ||
        data.repositories[0].id !== repositoryId ||
        data.repositories[0].full_name !== repository ||
        Object.entries(required).some(([name, right]) =>
          !['write', right].includes(data.permissions?.[name]) ||
          (right === 'write' && data.permissions[name] !== 'write')))
      throw Error('GitHub App token repository, grant or expiry did not match');
    return { token: data.token, expiresAt: expiry, permissions: { ...data.permissions } };
  }
  async function acquire() {
    if (current && current.expiresAt > clock() + 60000) return current;
    if (!renewal) renewal = exchange().then(value => (current = value))
      .finally(() => { renewal = null; });
    return renewal;
  }

  function checkGrant(grant, token) {
    if (typeof grant !== 'string' || !/^[a-z_]{2,50}:(read|write)$/.test(grant))
      throw Error('Every GitHub operation needs an explicit permission');
    const [name, level] = grant.split(':');
    if (!Object.hasOwn(required, name) ||
        (level === 'write' && required[name] !== 'write') ||
        !['write', level].includes(token.permissions[name]) ||
        (level === 'write' && token.permissions[name] !== 'write'))
      throw Error('Requested GitHub operation exceeds installed grant');
  }

  async function request({ method = 'GET', path = '/', permission, body } = {}) {
    method = String(method).toUpperCase();
    if (!REQUEST_METHODS.has(method)) throw Error('GitHub API method not admitted');
    if (method !== 'GET' && (body === null || typeof body !== 'object' ||
      Array.isArray(body))) throw Error('Mutation requires an explicit JSON object');
    if (method === 'GET' && body !== undefined)
      throw Error('GET request cannot contain mutation body');
    const url = safeRelativePath(path, repository);
    let grant = await acquire();
    checkGrant(permission, grant);
    const execute = async value => transport(url.href, {
      method, redirect: 'error',
      headers: { ...HEADERS, Authorization: 'Bearer ' + value.token,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    let response;
    try { response = await execute(grant); }
    catch (error) {
      // A write may have reached GitHub before the response was lost. Surface
      // the ambiguity explicitly so callers reconcile instead of replaying it.
      if (method !== 'GET') throw Error(
        'GitHub write outcome unknown; reconcile before retry', { cause: error });
      throw error;
    }
    if (response?.status === 401) {
      current = null;
      // Safe GETs can obtain a fresh token; writes may have an uncertain effect.
      if (method !== 'GET') throw Error('GitHub write outcome unknown; reconcile before retry');
      grant = await acquire();
      checkGrant(permission, grant);
      response = await execute(grant);
    }
    if (!response?.ok) throw Error('GitHub operation denied or unavailable: HTTP ' +
      (Number(response?.status) || 'unknown'));
    return response.status === 204 ? null : json(response);
  }

  return Object.freeze({
    request, status: () => statusOnly(current),
    invalidate() { current = null; },
  });
}
