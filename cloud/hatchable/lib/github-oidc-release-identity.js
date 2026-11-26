import { createVerify } from 'node:crypto';
import {
  CANONICAL_BRANCH_REF,
  CANONICAL_REPO,
  CANONICAL_REPO_ID,
  CANONICAL_WORKFLOW_REF,
} from './standing-release-policy.js';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const AUDIENCE = 'ultron.release-authorizer.v1';
const ENVIRONMENT = 'production-autonomous-release';
const SHA = /^[a-f0-9]{40}$/;

function deny(reason = 'release-oidc-untrusted') {
  throw Error(reason);
}

function derLength(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 255); n >>>= 8; }
  return Buffer.from([128 | bytes.length, ...bytes]);
}

function der(tag, payload) {
  return Buffer.concat([Buffer.from([tag]), derLength(payload.length), payload]);
}

function derInteger(value) {
  let bytes = Buffer.from(value, 'base64url');
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 128) === 0) bytes = bytes.subarray(1);
  if ((bytes[0] & 128) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(2, bytes);
}

function rsaJwkToPem(jwk) {
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') deny();
  const rsa = der(48, Buffer.concat([derInteger(jwk.n), derInteger(jwk.e)]));
  const algorithm = Buffer.from('300d06092a864886f70d0101010500', 'hex');
  const spki = der(48, Buffer.concat([algorithm, der(3, Buffer.concat([Buffer.from([0]), rsa]))]));
  const b64 = spki.toString('base64').match(/.{1,64}/g)?.join('\n');
  if (!b64) deny();
  return '-----BEGIN PUBLIC KEY-----\n' + b64 + '\n-----END PUBLIC KEY-----\n';
}

function decodeJwtPart(value) {
  if (typeof value !== 'string' || value.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(value)) deny();
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    deny();
  }
}

export async function verifyGithubReleaseOidc({
  token,
  fetchJwks = fetch,
  now = Date.now(),
  expectedWorkflowRef = CANONICAL_WORKFLOW_REF,
  expectedAudience = AUDIENCE,
  expectedEnvironment = ENVIRONMENT,
} = {}) {
  if (typeof token !== 'string' || token.length < 250 || token.length > 20000) deny('oidc-token-malformed');
  const parts = token.split('.');
  if (parts.length !== 3) deny('oidc-token-malformed');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') deny('oidc-alg-invalid');

  const epoch = Math.floor(now / 1000);
  if (claims?.iss !== ISSUER || claims.aud !== expectedAudience) deny('oidc-issuer-or-audience-invalid');
  if (claims.repository !== CANONICAL_REPO || String(claims.repository_id) !== String(CANONICAL_REPO_ID)) {
    deny('oidc-repository-invalid');
  }
  if (claims.repository_owner !== 'michaeljwilliams0123' || String(claims.repository_owner_id) !== '308995719') {
    deny('oidc-owner-invalid');
  }
  if (claims.ref !== CANONICAL_BRANCH_REF) deny('oidc-branch-invalid');
  if (claims.environment !== expectedEnvironment) deny('oidc-environment-invalid');
  if (claims.workflow_ref !== expectedWorkflowRef) deny('oidc-workflow-invalid');
  if (!['workflow_dispatch','workflow_run','schedule'].includes(claims.event_name)) {
    deny('oidc-pr-event-denied');
  }
  if (!SHA.test(claims.sha || '')) deny('oidc-sha-invalid');
  if (typeof claims.jti !== 'string' || claims.jti.length < 8 || claims.jti.length > 256) deny('oidc-jti-missing');
  const runId = Number(claims.run_id);
  const runAttempt = Number(claims.run_attempt || 1);
  if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
    deny('oidc-run-invalid');
  }
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat > epoch + 45 || claims.iat < epoch - 360 ||
      claims.exp < epoch || claims.exp > epoch + 600 ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 600) {
    deny('oidc-time-window-invalid');
  }

  let keys;
  try {
    const response = await fetchJwks(JWKS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) deny('oidc-jwks-unavailable');
    keys = (await response.json()).keys;
  } catch {
    deny('oidc-jwks-unavailable');
  }

  if (!Array.isArray(keys) || keys.length > 30) deny('oidc-jwks-invalid');
  const jwk = keys.find(k => k?.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256');
  if (!jwk) deny('oidc-key-not-found');

  let valid = false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(parts[0] + '.' + parts[1]);
    verifier.end();
    valid = verifier.verify(rsaJwkToPem(jwk), Buffer.from(parts[2], 'base64url'));
  } catch {
    deny('oidc-signature-invalid');
  }
  if (!valid) deny('oidc-signature-invalid');

  return Object.freeze({
    jti: claims.jti,
    sha: claims.sha,
    actor: claims.actor || null,
    workflowRef: claims.workflow_ref,
    workflowRunId: runId,
    workflowAttempt: runAttempt,
    environment: claims.environment,
    repositoryId: String(claims.repository_id),
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  });
}
