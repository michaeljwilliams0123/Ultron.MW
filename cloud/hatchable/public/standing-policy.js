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
    '.github/**',
    'config/**',
    'src/council-*.mjs',
    'src/security/**',
    'src/evidence/release-proof.mjs',
    'scripts/council-*.mjs',
    'scripts/enforce-council-acceptance.mjs',
    'scripts/verify*',
    'cloud/hatchable/lib/webauthn-owner.js',
    'cloud/hatchable/lib/autonomy-control.js',
    'cloud/hatchable/lib/release-github-readback.js',
    'cloud/hatchable/public/release-owner.html',
    'cloud/hatchable/public/standing-policy.js',
    'package.json',
    'package-lock.json',
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
      ...(typeof policy.enabled === 'boolean' ? { enabled: policy.enabled } : {}),
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

    const prepared = await json('/api/brain/release-standing-policy',
      {mode:'prepare',credentialId,maxReleases,days,enabled});
    const policy=prepared.policy;
    if(!prepared.ok||!policy||policy.ownerCredentialId!==credentialId||
      policy.maxReleases!==maxReleases||policy.enabled!==enabled||policy.maxCostUsd!==0||
      policy.stopVersion!==currentStopVersion||prepared.rpId!==location.hostname||
      Date.parse(prepared.challengeExpiresAt)-Date.now()<30000) throw Error('Prepared policy unavailable; refresh and try again.');
    const digestBytes=await sha256Bytes(canonicalStandingPolicyPayload(policy));
    if(bytesToHex(digestBytes)!==policy.policySha256||encode(digestBytes)!==prepared.challenge)
      throw Error('Prepared policy digest mismatch.');

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
    try { await json('/api/brain/release-standing-policy', { mode: 'enroll', policy, passkeyProof, enabled }); }
    catch {
      // Read back once; never replay an uncertain authorization.
      await refreshStandingPolicy();
      if(activePolicy?.policy_id!==policy.policyId||activePolicy?.policy_sha256!==policy.policySha256||
         activePolicy?.enabled!==enabled) throw Error('Enrollment not observed. Refresh status before preparing another request.');
      return;
    }
    await refreshStandingPolicy();
    if(activePolicy?.policy_id!==policy.policyId||activePolicy?.policy_sha256!==policy.policySha256||
       activePolicy?.enabled!==enabled) throw Error('Enrollment not independently observed.');
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
  if ($('credential')) new MutationObserver(updateButtons).observe($('credential'),{childList:true});
  $('load')?.addEventListener('click', () => setTimeout(updateButtons, 400));
  updateButtons();
  void act(refreshStandingPolicy)();
})();
