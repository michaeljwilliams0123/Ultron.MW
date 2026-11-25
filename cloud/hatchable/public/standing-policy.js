(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = s => { const el = $('sp-status'); if (el) el.textContent = s; };
  const STANDING_POLICY_SCHEMA = 'ultron.release-standing-policy.v1';
  const DEFAULT_DENIED_SECURITY_PATHS = [
    '.github/workflows/**',
    '.github/rulesets/**',
    'cloud/hatchable/lib/owner-passkey*',
    'cloud/hatchable/lib/standing-release-policy.js',
    'cloud/hatchable/lib/github-oidc-release-identity.js',
    'cloud/hatchable/lib/autonomous-release-eligibility.js',
    'cloud/hatchable/lib/deployment-release-receipt*',
    'cloud/hatchable/api/brain/release-standing-policy.js',
    'cloud/hatchable/api/brain/deployment-release-authorize.js',
    'cloud/hatchable/api/brain/deployment-release-receipt.js',
    'cloud/hatchable/migrations/**',
    'cloudflare/edge-shield/src/security.ts',
    'cloudflare/edge-shield/src/proxy.ts',
    'cloudflare/edge-shield/src/admin.ts',
    'cloudflare/edge-shield/src/release-readback.ts',
    'cloudflare/edge-shield/src/release-authorization.ts',
    'cloudflare/edge-shield/src/workflows/release-proof.ts',
    'cloudflare/edge-shield/src/index.ts',
    'cloudflare/edge-shield/src/queue.ts',
    'cloudflare/edge-shield/src/webhooks.ts',
    'cloudflare/edge-shield/wrangler*.toml',
    'cloud/hatchable/api/brain/release-authorization-wakeup.js',
    'cloud/hatchable/lib/autonomous-release-manifest.js',
    'cloud/hatchable/lib/release-proof*',
    'cloud/hatchable/lib/hatchable-manifest-readback.js',
    'cloud/hatchable/lib/independent-source-inventory.js',
    'cloud/hatchable/lib/council-deep-dispatch.js',
    'cloud/hatchable/lib/github-operator-release-fetch.js',
  ];

  function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
      return out;
    }
    return value;
  }

  function canonicalStandingPolicyPayload(policy) {
    return JSON.stringify(sortKeysDeep({
      schema: STANDING_POLICY_SCHEMA,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      ownerHandle: 'michaeljwilliams0123',
      ownerCredentialId: policy.ownerCredentialId,
      notBefore: policy.notBefore,
      expiresAt: policy.expiresAt,
      stopVersion: policy.stopVersion,
      maxReleases: policy.maxReleases,
      repository: 'michaeljwilliams0123/Ultron.MW',
      repositoryId: 1424939667,
      projectId: 'proj_A6GCXRSKizko',
      environment: 'production',
      branchRef: 'refs/heads/main',
      workflowRef: policy.workflowRef || 'michaeljwilliams0123/Ultron.MW/.github/workflows/release-authorize.yml@refs/heads/main',
      councilAppId: 5765239,
      targetPrefix: policy.targetPrefix || 'hatchable-v',
      allowRollback: Boolean(policy.allowRollback),
      allowedPathClasses: Array.isArray(policy.allowedPathClasses) ? [...policy.allowedPathClasses].sort() : ['**'],
      deniedPaths: Array.isArray(policy.deniedPaths) ? [...policy.deniedPaths].sort() : [...DEFAULT_DENIED_SECURITY_PATHS].sort(),
      requiredCiContexts: Array.isArray(policy.requiredCiContexts) ? [...policy.requiredCiContexts].sort() : ['Verify'],
      requiredProvenancePredicate: policy.requiredProvenancePredicate || 'ultron.release-eligibility.v1',
      maxCostUsd: 0,
    }));
  }

  const decode = v => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - v.length % 4) % 4)), x => x.charCodeAt(0));
  const encode = v => btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function sha256Bytes(text) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function json(path, body) {
    const r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data;
    try { data = await r.json(); } catch { throw Error('Response unavailable; check owner sign-in.'); }
    if (!r.ok) throw Error(data?.reason || ('HTTP ' + r.status));
    return data;
  }

  let activePolicy = null;
  let currentStopVersion = null;
  let busy = false;

  function updateButtons() {
    const cred = $('credential')?.value || '';
    if ($('sp-refresh')) $('sp-refresh').disabled = busy;
    if ($('sp-enroll')) $('sp-enroll').disabled = busy || !cred || !Number.isSafeInteger(currentStopVersion);
    if ($('sp-revoke')) $('sp-revoke').disabled = busy || !activePolicy || Boolean(activePolicy.revoked_at);
  }

  const act = fn => async () => {
    if (busy) return;
    busy = true;
    updateButtons();
    try { await fn(); } catch (e) { status(String(e?.message || 'Standing policy request failed')); } finally { busy = false; updateButtons(); }
  };

  async function refreshStandingPolicy() {
    const [view, autonomy] = await Promise.all([
      json('/api/brain/release-standing-policy'),
      json('/api/brain/autonomy'),
    ]);
    activePolicy = view.policy || null;
    currentStopVersion = Number(autonomy?.profile?.stopVersion);
    status(JSON.stringify({
      stopVersion: currentStopVersion,
      paused: Boolean(autonomy?.profile?.paused),
      policy: activePolicy ? {
        policyId: activePolicy.policy_id,
        policyVersion: activePolicy.policy_version,
        policySha256: activePolicy.policy_sha256,
        enabled: activePolicy.enabled,
        stopVersion: activePolicy.stop_version,
        maxReleases: activePolicy.max_releases,
        maxCostUsd: activePolicy.max_cost_usd,
        expiresAt: activePolicy.expires_at,
        revokedAt: activePolicy.revoked_at || null,
        revokedReason: activePolicy.revoked_reason || null,
      } : null,
    }, null, 2));
  }

  async function enrollStandingPolicyWithPasskey() {
    if (!navigator.credentials?.get) throw Error('WebAuthn passkey support is required.');
    const credentialId = $('credential')?.value || '';
    if (!credentialId) throw Error('Select an enrolled owner passkey first.');
    if (!Number.isSafeInteger(currentStopVersion)) throw Error('Refresh standing policy state first.');
    const maxReleases = Number($('sp-max-releases')?.value);
    const days = Number($('sp-days')?.value);
    const enabled = Boolean($('sp-enabled')?.checked);
    if (!Number.isSafeInteger(maxReleases) || maxReleases < 1 || maxReleases > 100) throw Error('Max releases must be 1–100.');
    if (!Number.isSafeInteger(days) || days < 1 || days > 31) throw Error('Validity days must be 1–31.');

    const now = Date.now();
    const policy = {
      schema: STANDING_POLICY_SCHEMA,
      policyId: 'srp-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      policyVersion: (Number(activePolicy?.policy_version) || 0) + 1,
      ownerHandle: 'michaeljwilliams0123',
      ownerCredentialId: credentialId,
      notBefore: new Date(now).toISOString(),
      expiresAt: new Date(now + days * 86400 * 1000).toISOString(),
      stopVersion: currentStopVersion,
      maxReleases,
      repository: 'michaeljwilliams0123/Ultron.MW',
      repositoryId: 1424939667,
      projectId: 'proj_A6GCXRSKizko',
      environment: 'production',
      branchRef: 'refs/heads/main',
      workflowRef: 'michaeljwilliams0123/Ultron.MW/.github/workflows/release-authorize.yml@refs/heads/main',
      councilAppId: 5765239,
      targetPrefix: 'hatchable-v',
      allowRollback: false,
      allowedPathClasses: ['**'],
      deniedPaths: [...DEFAULT_DENIED_SECURITY_PATHS],
      requiredCiContexts: ['Verify'],
      requiredProvenancePredicate: 'ultron.release-eligibility.v1',
      maxCostUsd: 0,
    };
    const digestBytes = await sha256Bytes(canonicalStandingPolicyPayload(policy));
    policy.policySha256 = bytesToHex(digestBytes);

    if (!confirm(`Enroll standing release policy (${maxReleases} releases, ${days} days, $0 cost cap, enabled=${enabled})?`)) return;

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: digestBytes,
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: decode(credentialId) }],
        userVerification: 'required',
        timeout: 120000,
      },
    });
    if (!assertion || assertion.type !== 'public-key') throw Error('Passkey assertion not confirmed.');

    const passkeyProof = {
      credentialId: encode(assertion.rawId),
      authenticatorData: encode(assertion.response.authenticatorData),
      clientDataJSON: encode(assertion.response.clientDataJSON),
      signature: encode(assertion.response.signature),
    };
    await json('/api/brain/release-standing-policy', { mode: 'enroll', policy, passkeyProof, enabled });
    await refreshStandingPolicy();
  }

  async function revokeActivePolicy() {
    if (!activePolicy?.policy_id) throw Error('No standing policy to revoke.');
    if (!confirm(`Revoke standing policy ${activePolicy.policy_id} and bump stop version?`)) return;
    await json('/api/brain/release-standing-policy', {
      mode: 'revoke',
      policyId: activePolicy.policy_id,
      reason: 'owner-revoked',
      bumpStop: true,
    });
    await refreshStandingPolicy();
  }

  $('sp-refresh')?.addEventListener('click', act(refreshStandingPolicy));
  $('sp-enroll')?.addEventListener('click', act(enrollStandingPolicyWithPasskey));
  $('sp-revoke')?.addEventListener('click', act(revokeActivePolicy));
  $('credential')?.addEventListener('change', updateButtons);
  $('load')?.addEventListener('click', () => setTimeout(updateButtons, 400));
  updateButtons();
  void act(refreshStandingPolicy)();
})();
