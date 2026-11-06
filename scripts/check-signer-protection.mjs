import { verifySignerProtection } from '../src/autonomy/signer-protection.mjs';

if (process.env.GITHUB_REPOSITORY !== 'michaeljwilliams0123/Ultron.MW' ||
    process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GH_TOKEN)
  throw new Error('unapproved-workflow-context');
const base = 'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
async function get(path) {
  const response = await fetch(base + path, { redirect: 'error',
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'User-Agent': 'Ultron-independent-signer', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('signer-protection-read-unavailable');
  return response.json();
}
verifySignerProtection(await get('/environments/ultron-independent-signer'),
  await get('/branches/main/protection'),
  await get('/environments/ultron-independent-signer/deployment-branch-policies'));
