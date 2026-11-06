import { createHash, randomUUID, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const allowed = Object.freeze([
  'mcp.queue.submit',
  'mcp.task.control'
]);
const objectives = Object.freeze(['repo.inspect', 'repo.prs', 'repo.ci', 'site.render', 'council.review']);
const controlActions = Object.freeze(['cancel', 'retry', 'unblock']);
const policy = JSON.stringify({
  schema: 'ultron.actions-signing-policy.v2',
  actor: 'mcp:ultron',
  operations: allowed,
  objectives,
  controlActions,
  administrativeChange: false,
  maxTtlSeconds: 300
});
export const SIGNING_POLICY_SHA = createHash('sha256').update(policy).digest('hex');

export function grantRequestForMutation(mutation) {
  if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation))
    throw new Error('mutation-rejected-by-signing-policy');
  const queue = mutation.operation === 'mcp.queue.submit';
  const control = mutation.operation === 'mcp.task.control';
  const fields = queue ? 'expectedProfileVersion,expectedStopVersion,key,objective,operation' :
    'action,expectedProfileVersion,expectedStopVersion,id,key,operation';
  if ((!queue && !control) || Object.keys(mutation).sort().join(',') !== fields ||
      typeof mutation.key !== 'string' || !/^[a-z0-9-]{6,80}$/.test(mutation.key) ||
      !Number.isSafeInteger(mutation.expectedProfileVersion) || mutation.expectedProfileVersion < 1 ||
      !Number.isSafeInteger(mutation.expectedStopVersion) || mutation.expectedStopVersion < 1 ||
      (queue && !objectives.includes(mutation.objective)) ||
      (control && (!controlActions.includes(mutation.action) ||
        !Number.isSafeInteger(mutation.id) || mutation.id < 1 || mutation.id > 1000000000)))
    throw new Error('mutation-rejected-by-signing-policy');
  const canonical = JSON.stringify(['ultron.mcp.mutation.v1', mutation.operation, mutation.key,
    queue ? mutation.objective : mutation.action, queue ? null : mutation.id,
    mutation.expectedProfileVersion, mutation.expectedStopVersion]);
  return { actor: 'mcp:ultron', objectiveId: mutation.key, operation: mutation.operation,
    resource: 'sha256:' + createHash('sha256').update(canonical).digest('hex'),
    administrativeChange: false };
}

export async function signApprovedRequest({ request, mutation, privateJwk, now = Date.now() }) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).sort().join(',') !== 'actor,administrativeChange,objectiveId,operation,resource' ||
      request.actor !== 'mcp:ultron' || request.administrativeChange !== false ||
      !allowed.includes(request.operation) ||
      typeof request.objectiveId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{5,127}$/.test(request.objectiveId) ||
      typeof request.resource !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(request.resource) ||
      !Number.isSafeInteger(now)) throw new Error('request-rejected-by-signing-policy');
  const expected = grantRequestForMutation(mutation);
  if (Object.keys(expected).some(key => expected[key] !== request[key]))
    throw new Error('mutation-grant-mismatch');
  if (!privateJwk || privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' ||
      typeof privateJwk.d !== 'string') throw new Error('invalid-signing-key');
  const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const payload = JSON.stringify({
    schema: 'ultron.security-grant.v1',
    grantId: `actions-${randomUUID()}`,
    issuer: 'ultron-independent-security',
    audience: 'ultron-cloud-brain',
    ...request,
    policySha: SIGNING_POLICY_SHA,
    notBefore: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString()
  });
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload));
  return { payload, signature: Buffer.from(signature).toString('base64url') };
}

export async function encryptGrant(envelope, recipientJwk) {
  if (!recipientJwk || recipientJwk.kty !== 'RSA' || recipientJwk.d ||
      typeof recipientJwk.n !== 'string' || typeof recipientJwk.e !== 'string')
    throw new Error('invalid-recipient-key');
  const recipient = await subtle.importKey('jwk', recipientJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  if (recipient.algorithm.modulusLength < 2048) throw new Error('recipient-key-too-small');
  const rawKey = webcrypto.getRandomValues(new Uint8Array(32));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const aes = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, aes,
    new TextEncoder().encode(JSON.stringify(envelope)));
  const encryptedKey = await subtle.encrypt({ name: 'RSA-OAEP' }, recipient, rawKey);
  rawKey.fill(0);
  return {
    schema: 'ultron.encrypted-grant.v1',
    encryptedKey: Buffer.from(encryptedKey).toString('base64url'),
    iv: Buffer.from(iv).toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url')
  };
}
