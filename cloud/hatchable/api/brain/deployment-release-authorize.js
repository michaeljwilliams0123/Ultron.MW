import { db, config, api } from 'hatchable';
import { verifyGithubReleaseOidc } from 'lib/github-oidc-release-identity.js';
import { evaluateAndAuthorizeAutonomousRelease } from 'lib/autonomous-release-eligibility.js';
import { createAuthenticatedGithubReleaseFetch } from 'lib/github-operator-release-fetch.js';
import { collectConnectivity } from 'lib/connectivity-view.js';
import { collectMergedCouncilReadback } from 'lib/release-github-readback.js';
import { discoverAutonomousReleaseManifest } from 'lib/autonomous-release-manifest.js';

export const access = 'public';
export const methods = ['POST'];

const SHA = /^[a-f0-9]{40}$/;
const TARGET_RE = /^hatchable-v([1-9][0-9]{0,8})$/;

function extractBearer(headers) {
  const auth = typeof headers?.get === 'function'
    ? headers.get('authorization')
    : (headers?.authorization || headers?.Authorization || '');
  const m = /^Bearer\s+([^\s]+)$/.exec(String(auth || ''));
  return m ? m[1] : null;
}

async function fetchIndependentChangedFiles({ fetchGithub, baseSha, headSha }) {
  if (!SHA.test(baseSha || '') || !SHA.test(headSha || '')) {
    return { available: false, truncated: false, files: [] };
  }
  if (baseSha === headSha) {
    return { available: true, truncated: false, files: [] };
  }
  const url = `https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/compare/${baseSha}...${headSha}?per_page=100&page=1`;
  const res = await fetchGithub(url, { method: 'GET' });
  if (!res.ok) return { available: false, truncated: false, files: [] };
  const body = await res.json();
  if (!body || !Array.isArray(body.files) || (body.status !== 'ahead' && body.status !== 'identical')) {
    return { available: false, truncated: false, files: [] };
  }
  // GitHub compare returns up to 300 files; fail closed if truncated or >= 100 on single page.
  const truncated = body.files.length >= 100 || (Number.isSafeInteger(body.total_commits) && body.files.length >= 300);
  const files = [];
  for (const f of body.files) {
    if (typeof f?.filename === 'string' && f.filename) files.push(f.filename);
    if (typeof f?.previous_filename === 'string' && f.previous_filename) files.push(f.previous_filename);
  }
  return { available: !truncated, truncated, files };
}

export default async function (req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, decision: 'denied', reason: 'method-not-allowed' });
  }
  const token = extractBearer(req.headers);
  if (!token) {
    return res.status(401).json({ ok: false, decision: 'denied', reason: 'oidc-bearer-required' });
  }

  let oidcIdentity;
  try {
    oidcIdentity = await verifyGithubReleaseOidc({ token });
  } catch (err) {
    return res.status(403).json({
      ok: false,
      decision: 'denied',
      reason: err instanceof Error ? err.message : 'release-oidc-untrusted',
    });
  }

  const requestedMode=req.body?.mode ?? 'decision-only';
  if(!['auto','authorize','decision-only'].includes(requestedMode))return res.status(400).json({ok:false,decision:'denied',reason:'mode-invalid'});
  let mode=requestedMode;
  try {
    if(mode==='auto'){
      const policy=await db.query('SELECT enabled FROM brain_standing_release_policies ORDER BY policy_version DESC LIMIT 1');
      mode=policy?.rows?.[0]?.enabled===true?'authorize':'decision-only';
    }
    const fetchGithub = createAuthenticatedGithubReleaseFetch({
      call: (name, args) => api.call(name, args),
    });
    const observation = await collectConnectivity({ db, fetchGithub });
    const mainSha = observation.github?.mainSha || null;
    const councilSource = mainSha
      ? await collectMergedCouncilReadback({ commitSha: mainSha, fetchGithub })
      : { councilCheck: null };

    // P0-2: Independently retrieve previous verified deployment version & source SHA.
    const prevRes = await db.query(
      `SELECT target, source_sha FROM brain_deployment_release_receipts ORDER BY id DESC LIMIT 1`,
    );
    const prevRow = prevRes?.rows?.[0] || null;
    const prevMatch = TARGET_RE.exec(prevRow?.target || '');
    const previousDeploymentVersion = prevMatch ? Number(prevMatch[1]) : null;
    const previousSourceSha = SHA.test(prevRow?.source_sha || '') ? prevRow.source_sha : null;

    // P0-1: Independently fetch changed files from GitHub compare API; never trust caller-supplied file lists.
    const diff = mainSha && previousSourceSha
      ? await fetchIndependentChangedFiles({ fetchGithub, baseSha: previousSourceSha, headSha: mainSha }).catch(() => ({
          available: false,
          truncated: false,
          files: [],
        }))
      : { available: false, truncated: false, files: [] };

    const liveDeployment=await discoverAutonomousReleaseManifest({config,fetchGithub,sourceSha:oidcIdentity.sha});

    const evidence = {
      mainSha,
      ciVerified: observation.ci?.state === 'observed' && observation.ci?.conclusion === 'success',
      ciSha: observation.ci?.sourceSha || null,
      councilVerified: councilSource?.councilCheck?.conclusion === 'success',
      provenanceVerified: Boolean(liveDeployment?.verified && liveDeployment?.attestorRunId),
      provenanceSha: oidcIdentity.sha,
      changedFilesAvailable: diff.available,
      changedFilesTruncated: diff.truncated,
      changedFiles: diff.files,
      previousDeploymentVersion,
      liveDeployment,
    };

    const result = await evaluateAndAuthorizeAutonomousRelease({
      db,
      oidcIdentity,
      evidence,
      mode,
    });
    return res.status(result.ok ? 200 : (result.decision === 'human-required' ? 202 : 403)).json({
      schema: 'ultron.deployment-release-authorize.v1',
      ...result,
    });
  } catch {
    return res.status(503).json({
      schema: 'ultron.deployment-release-authorize.v1',
      ok: false,
      decision: 'denied',
      reason: 'autonomous-release-verifier-unavailable',
    });
  }
}
