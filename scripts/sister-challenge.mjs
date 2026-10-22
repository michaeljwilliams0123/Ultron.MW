/**
 * Explicit local/secure-runner entrypoint. Never run on untrusted fork events
 * or print authenticated API payloads. Requires an owner-provided, read-only
 * token with access to both repositories and repository Actions/ruleset reads.
 */
import { observeSisterChallenge, renderSisterChallenge } from '../src/sister-challenge.mjs';

const token = process.env.ULTRON_SISTER_READ_TOKEN;
if (!token) {
  console.error('Sister Challenge unavailable: owner-scoped read credential not configured.');
  process.exitCode = 2;
} else {
  const origin = 'https://api.github.com';
  const read = async path => {
    if (typeof path !== 'string' || !path.startsWith('/repos/michaeljwilliams0123/')) {
      throw Error('sister-unapproved-host-or-repository');
    }
    const response = await fetch(origin + path, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error('sister-read-failed-' + response.status);
    return response.json();
  };
  try {
    const result = await observeSisterChallenge({ get: read });
    process.stdout.write(renderSisterChallenge(result));
  } catch (error) {
    // Do not print response payloads, URLs, credential details or private code.
    console.error('Sister Challenge did not establish verified read evidence.');
    process.exitCode = 1;
  }
}
