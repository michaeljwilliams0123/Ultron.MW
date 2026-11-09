# Cloud-first owner passkey dispatch — staged security foundation

Status: **source-only prerequisite**. No passkey enrollment, WebAuthn assertion exchange, or GitLab write via passkey is deployed or authorized by this change.

## Authority and objective

Ultron's production runtime stays on Hatchable. The owner is the sole required human approver. The existing P-256 owner signing key remains outside Hatchable; a passkey would provide owner-presence approval without copying that private key into the server.

Current production GitLab branch creation still uses `/api/brain/gitlab-branch` with a short-lived, scoped owner-signed envelope. Its backend enforces the current owner profile and stop versions, $0 ceiling, one-shot PostgreSQL claim, GitLab preflight, and independent readback. Do not introduce an alternate direct-write endpoint or accept a generic successful authentication session as an authorization grant.

## What this source change adds

- `lib/webauthn-owner.js`: a pure verifier of an ES256 passkey assertion, with exact RP ID, origin, user verification, challenge, credential identity, DER signature and counter extraction.
- Migration `0033_owner_passkey_authority.sql`: passkey registry and one-use, TTL-bounded operation-specific challenges. It changes **no owner profile, allowed operation, stop counter, grant, or existing production behavior**.
- Negative assertion tests and a PGlite migration/idempotence test.

## Integration work still required before enabling

1. Owner-authenticated registration challenge endpoint; verify WebAuthn registration attestation and binding to the registered public key, credential ID, RP ID, origin and fresh challenge. Registration must consume a distinct short-lived owner-issued signed grant with the current profile/stop versions and must never silently trust a client-provided SPKI key.
2. Browser `navigator.credentials.create` and `navigator.credentials.get` UI: the credential remains in platform authenticator, with no private signing material exported.
3. Bind an assertion challenge to the exact server-prepared `gitlab.branch.create` grant request: idempotency key, target GitLab project, source SHA, immutable policy SHA, profile/stop versions, expiry, and zero paid spend.
4. Verify the assertion and atomically consume the challenge with the **existing** provider claim; enforce replay protection, signature counter behavior, concurrent requests and stop/pause races. Never create a second GitLab POST path.
5. Run focused invalid-origin/RP, wrong-credential, replay, expiry, duplicate-action, stop/profile, lost-ack, and postcondition tests before shipping owner enrollment and a single authorized live GitLab canary.
6. Only after exact-head CI, protected squash merge, Hatchable dry run, migration readback, owner passkey enrollment and GitLab branch readback should operational acceptance be declared.

## Release boundaries

- GitHub: authoritative source and CI; GitLab: authenticated integrated provider and mirrored-source acceptance; GitBook: documentation.
- No paid provider usage, credit purchases, auto-recharge, or fallback; incremental authorized spend remains **$0**.
- No production passkey authorization or GitLab mutation is claimed by the schema and verifier foundation alone.
- Keep existing signed-envelope recovery functional until a passkey path is fully exercised and auditable.
