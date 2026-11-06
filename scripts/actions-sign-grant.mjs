import { writeFile } from 'node:fs/promises';
import { signApprovedRequest, encryptGrant } from '../src/autonomy/independent-signer.mjs';

if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REPOSITORY !== 'michaeljwilliams0123/Ultron.MW' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_ACTOR !== 'michaeljwilliams0123')
  throw new Error('unapproved-workflow-context');
function parseJson(value, label) {
  try { return JSON.parse(value || 'null'); }
  catch { throw new Error(`invalid-${label}`); }
}
const request = parseJson(process.env.ULTRON_GRANT_REQUEST, 'request');
const mutation = parseJson(process.env.ULTRON_MUTATION, 'mutation');
const privateJwk = parseJson(process.env.ULTRON_SIGNER_PRIVATE_JWK, 'signing-key');
const recipientJwk = parseJson(process.env.ULTRON_GRANT_RECIPIENT_PUBLIC_JWK, 'recipient-key');
const envelope = await signApprovedRequest({ request, mutation, privateJwk });
const encrypted = await encryptGrant(envelope, recipientJwk);
await writeFile('encrypted-grant.json', JSON.stringify(encrypted), { flag: 'wx', mode: 0o600 });
