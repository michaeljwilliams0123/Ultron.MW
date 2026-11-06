import { webcrypto } from 'node:crypto';
import { verifyDelegatedGrant } from '../../cloud/hatchable/lib/security-adjudicator.js';
import { grantRequestForMutation, SIGNING_POLICY_SHA } from './independent-signer.mjs';

function decode(value, min, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid-encrypted-grant');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64url') !== value)
    throw new Error('invalid-encrypted-grant');
  return bytes;
}

export async function decryptVerifiedGrant({ encrypted, recipientPrivateJwk, signerPublicJwk,
  mutation, now } = {}) {
  if (!encrypted || typeof encrypted !== 'object' || Array.isArray(encrypted) ||
      Object.keys(encrypted).sort().join(',') !== 'ciphertext,encryptedKey,iv,schema' ||
      encrypted.schema !== 'ultron.encrypted-grant.v1' ||
      !recipientPrivateJwk || recipientPrivateJwk.kty !== 'RSA' ||
      typeof recipientPrivateJwk.d !== 'string')
    throw new Error('invalid-encrypted-grant');
  const request = grantRequestForMutation(mutation);
  const encryptedKey = decode(encrypted.encryptedKey, 256, 1024);
  const iv = decode(encrypted.iv, 12, 12);
  const ciphertext = decode(encrypted.ciphertext, 17, 8192);
  const { subtle } = webcrypto;
  const recipient = await subtle.importKey('jwk', recipientPrivateJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  if (recipient.algorithm.modulusLength < 2048) throw new Error('recipient-key-too-small');
  const rawKey = new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, recipient, encryptedKey));
  let plaintext;
  try {
    if (rawKey.length !== 32) throw new Error('invalid-encrypted-grant');
    const aes = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    plaintext = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, aes, ciphertext));
  } finally {
    rawKey.fill(0);
  }
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } finally {
    plaintext.fill(0);
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'payload,signature')
    throw new Error('invalid-grant-envelope');
  const grant = await verifyDelegatedGrant({ envelope, publicJwk: signerPublicJwk,
    request, subtle, ...(now === undefined ? {} : { now }) });
  if (grant.policySha !== SIGNING_POLICY_SHA) throw new Error('unexpected-signing-policy');
  return { envelope, grant };
}
