# Cloud-first owner passkey dispatch — staged security foundation

Status: **release candidate**. The registration and passkey-authorized GitLab branch pathways are implemented and tested in source. Do not claim a real enrolled owner credential or external provider effect until the owner completes WebAuthn enrollment and the GitLab branch is read back in production.

## Authority and objective

Ultron's production runtime stays on Hatchable. The owner is the sole required human approver. The existing P-256 owner signing key remains outside Hatchable; a passkey would provide owner-presence approval without copying that private key into the server.

Current production GitLab branch creation still uses `/api/brain/gitlab-branch` with a short-lived, scoped owner-signed envelope. Its backend enforces the current owner profile and stop versions, $0 ceiling, one-shot PostgreSQL claim, GitLab preflight, and independent readback. Do not introduce an alternate direct-write endpoint or accept a generic successful authentication session as an authorization grant.

## What this source change adds

- `lib/webauthn-owner.js`: a pure verifier of an ES256 passkey assertion, with exact RP ID, origin, user verification, challenge, credential identity, DER signature and counter extraction.
- Migration `0033_owner_passkey_authority.sql`: passkey registry and one-use, TTL-bounded operation-specific challenges. It changes **no owner profile, allowed operation, stop counter, grant, or existing production behavior**.
- Negative assertion tests and a PGlite migration/idempotence test.

## Owner deployment and first-device acceptance

1. Merge the source after exact-head CI and deploy the matching `cloud/hatchable` files to the existing Hatchable app. Migration 0034 corrects the v66 PostgreSQL credential regex constraints and opts in to `owner.passkey.enroll` with a one-time owner profile-version increment.
2. Visit `/passkey-owner.html` while signed into the Hatchable owner account. Select a device label and click **Prepare owner enrollment**. Copy the exact signable request.
3. On a trusted device where the existing owner's private JWK resides, save the request as JSON and run `node scripts/owner-grant.mjs sign ABSOLUTE_PRIVATE_JWK ABSOLUTE_REQUEST_JSON`. Do not upload or paste the private key into any website, issue, action log, or cloud environment. Paste only the short-lived signed envelope into the owner UI.
4. Click **Create passkey on this device**; approve the native browser/platform authenticator prompt. The registration verifies origin, RP, challenge, UV, ES256 COSE public key and the existing signed owner grant; one database transaction consumes the session, registers the key and persists the grant receipt.
5. Select the registered passkey, exact GitHub/GitLab `main` SHA and a durable action key. Click **Prepare one branch**, then **Authorize with passkey and create branch**. The browser's `navigator.credentials.get` ceremony signs the operation-bound challenge; a one-shot claim shares the existing provider write/readback engine.
6. Confirm the GitLab branch at that exact source SHA, the owner's cloud provider-write receipt and zero additional paid spend. If a submit returns an uncertain result, click **Read back existing attempt** only; never submit a second provider mutation for the same key. Use the existing signed-envelope route as a recovery path.
7. No production acceptance is claimed until the owner has physically completed the passkey prompt and the external GitLab branch and durable receipt both match. Profile-version changes invalidate grants prepared against the prior profile, by design.

## Release boundaries

- GitHub: authoritative source and CI; GitLab: authenticated integrated provider and mirrored-source acceptance; GitBook: documentation.
- No paid provider usage, credit purchases, auto-recharge, or fallback; incremental authorized spend remains **$0**.
- No production passkey authorization or GitLab mutation is claimed by the schema and verifier foundation alone.
- Keep existing signed-envelope recovery functional until a passkey path is fully exercised and auditable.
