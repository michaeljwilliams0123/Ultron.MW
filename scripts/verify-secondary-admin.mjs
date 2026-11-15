import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TARGET = Object.freeze({ owner: 'michaeljwilliams0123', name: 'Ultron.MW', id: 1424939667 });

export function readConfiguration(env = process.env) {
  const appId = env.SECONDARY_ADMIN_APP_ID ?? env.ULTRON_SECONDARY_ADMIN_APP_ID;
  const installationId = env.SECONDARY_ADMIN_INSTALLATION_ID ?? env.ULTRON_SECONDARY_ADMIN_INSTALLATION_ID;
  const privateKey = env.ULTRON_SECONDARY_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!/^[1-9][0-9]*$/.test(appId ?? '') || !/^[1-9][0-9]*$/.test(installationId ?? '') || !privateKey) throw new Error('Missing or invalid secondary Admin App configuration.');
  return { appId, installationId, privateKey };
}

export function generateAppJwt(appId, privateKey, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId })).toString('base64url');
  const unsignedToken = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  return `${unsignedToken}.${signer.sign(privateKey, 'base64url')}`;
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}).`);
  return response.json();
}

export async function verifySecondaryAdmin(configuration) {
  const jwt = generateAppJwt(configuration.appId, configuration.privateKey);
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'User-Agent': 'ultron-secondary-admin-verifier' };
  const tokenData = await request(`https://api.github.com/app/installations/${configuration.installationId}/access_tokens`, {
    method: 'POST', headers, body: JSON.stringify({ repositories: [TARGET.name] }),
  });
  if (!tokenData.token || !tokenData.expires_at) throw new Error('GitHub returned an invalid installation-token response.');
  const repository = await request(`https://api.github.com/repos/${TARGET.owner}/${TARGET.name}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.token}`, 'User-Agent': 'ultron-secondary-admin-verifier' },
  });
  if (repository.id !== TARGET.id || repository.full_name !== `${TARGET.owner}/${TARGET.name}`) throw new Error('Readback did not resolve to the canonical Ultron repository.');
  return { repository: repository.full_name, repositoryId: repository.id, expiresAt: tokenData.expires_at, permissions: tokenData.permissions ?? {} };
}

export async function main() {
  try { console.log(JSON.stringify({ verified: true, ...(await verifySecondaryAdmin(readConfiguration())) })); }
  catch (error) { console.error(`Secondary Admin verification failed: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
