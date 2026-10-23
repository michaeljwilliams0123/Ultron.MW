#!/usr/bin/env node
/**
 * Read-only GitHub App installation admission probe.
 * No key, JWT or installation token is ever printed.
 */
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createGitHubAppOperator } from '../src/computer/github-app-operator.mjs';

const repository = 'michaeljwilliams0123/Ultron.MW';
const repositoryId = 1424939667;
async function main() {
  const clientId = process.env.ULTRON_GITHUB_APP_CLIENT_ID;
  const installationId = Number(process.env.ULTRON_GITHUB_APP_INSTALLATION_ID);
  const keyLocation = process.env.ULTRON_GITHUB_APP_PRIVATE_KEY_FILE;
  if (!clientId || !Number.isSafeInteger(installationId) ||
      installationId <= 0 || !keyLocation || !isAbsolute(keyLocation))
    throw Error('GitHub App identity grant is not configured');
  const keyPath = await realpath(keyLocation);
  const project = await realpath(resolve(import.meta.dirname, '..'));
  const insideRepo = relative(project, keyPath);
  if (insideRepo === '' || insideRepo === '.' ||
      !insideRepo.startsWith('..') && !isAbsolute(insideRepo))
    throw Error('Refusing a private key stored inside the public repository');
  const operator = createGitHubAppOperator({
    clientId, installationId, repository, repositoryId,
    permissions: { contents: 'read' },
    loadPrivateKey: () => readFile(keyPath, 'utf8'),
  });
  const observed = await operator.request({
    method: 'GET', path: '/', permission: 'contents:read',
  });
  if (observed?.id !== repositoryId || observed?.full_name !== repository)
    throw Error('Live installation repository identity does not match');
  console.log(JSON.stringify({
    admission: 'VERIFIED_READ_ONLY', identity: 'github-app-installation',
    repository, repositoryId, expiresAt: operator.status().expiresAt,
    tokenPrinted: false, ownerBrowserMfaCompleted: false,
  }));
}
main().catch(() => {
  console.error('GitHub App read-only admission is unavailable or not configured.');
  process.exitCode = 2;
});
