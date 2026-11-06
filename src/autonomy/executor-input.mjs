import { createHash } from 'node:crypto';

export function decodeExecutionInput(encoded, expectedSha) {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 60000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
      typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha))
    throw new Error('invalid-execution-input');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > 45000 || bytes.toString('base64') !== encoded ||
      createHash('sha256').update(bytes).digest('hex') !== expectedSha)
    throw new Error('execution-digest-mismatch');
  return bytes;
}
