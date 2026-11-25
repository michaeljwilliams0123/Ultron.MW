import { db, config, api } from 'hatchable';
import { verifyGithubReleaseOidc } from 'lib/github-oidc-release-identity.js';
import { evaluateAndAuthorizeAutonomousRelease } from 'lib/autonomous-release-eligibility.js';
import { createAuthenticatedGithubReleaseFetch } from 'lib/github-operator-release-fetch.js';
import { collectConnectivity } from 'lib/connectivity-view.js';
import { collectMergedCouncilReadback } from 'lib/release-github-readback.js';
import { verifyLiveHatchableManifest } from 'lib/hatchable-manifest-readback.js';

export const access = 'public';
export const methods = ['POST'];

function extractBearer(headers) {
  const auth = typeof headers?.get === 'function'
    ? headers.get('authorization')
    : (headers?.authorization || headers?.Authorization || '');
  const m = /^Bearer\s+([^\s]+)$/.exec(String(auth || ''));
  return m ? m[1] : null;
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

  const mode = req.body?.mode === 'authorize' ? 'authorize' : 'decision-only';
  try {
    const fetchGithub = createAuthenticatedGithubReleaseFetch({
      call: (name, args) => api.call(name, args),
    });
    const observation = await collectConnectivity({ db, fetchGithub });
    const mainSha = observation.github?.mainSha || null;
    const councilSource = mainSha
      ? await collectMergedCouncilReadback({ commitSha: mainSha, fetchGithub })
      : { councilCheck: null };
    const liveDeployment = await verifyLiveHatchableManifest({
      config,
      fetchGithub,
      deploymentRow: {
        target: req.body?.target || null,
        source_sha: oidcIdentity.sha,
        artifact_digest: req.body?.artifactDigest || null,
        manifest_file_count: req.body?.manifestFileCount ?? null,
      },
    }).catch(() => null);

    const evidence = {
      mainSha,
      ciVerified: observation.ci?.state === 'observed' && observation.ci?.conclusion === 'success',
      ciSha: observation.ci?.sourceSha || null,
      councilVerified: councilSource?.councilCheck?.conclusion === 'success',
      provenanceVerified: Boolean(liveDeployment?.verified && liveDeployment?.attestorRunId),
      provenanceSha: oidcIdentity.sha,
      changedFiles: Array.isArray(req.body?.changedFiles) ? req.body.changedFiles : [],
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
