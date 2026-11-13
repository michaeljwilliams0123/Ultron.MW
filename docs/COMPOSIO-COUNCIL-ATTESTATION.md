# Composio Council Attestation — execution gate and limits

This is a **source-only** security interface for PR #442, not evidence of production authentication, deployment, seven App sign-offs, or authority to merge.

## Why the demonstration mock is insufficient

The uploaded `MockComposioClient` demonstrates control flow only. Any nonempty string satisfies its `authenticated` flag, sessions have random IDs without real Composio verification, and `isAuthorizedByCouncil` is supplied by the caller. Those tests cannot prove a real OAuth handshake, identity mapping, owner signature, durable nonce, GitHub App execution, or independent remote readback. Do not place its sample key or an extra `ci.yml` in the repository.

## Implemented bridge boundary

- `src/security/composio-council-attestation.mjs` verifies a signed Ed25519 Council verdict against server-pinned public keys with an explicit domain, exact canonical source SHA and PR number, key ID, freshness/expiry, single-use nonce, and a restricted accepted (7/7, non-security-sensitive) decision.
- `createTrustedComposioCouncilVerifier` produces a marked trusted verifier; the worker's `executeGovernedGitHubAppMutation` rejects bare `councilResult` objects, caller-controlled booleans and unmarked callbacks **before** owner middleware or token issuance.
- `createPostgresComposioCouncilNonceStore({db})` uses the existing migration `0037_github_approval_nonces.sql` unique-key nonce ledger with a separate `council-` namespace and signed-attestation operation label. The atomic insert-if-absent must succeed before the Council result is returned.
- After authenticated Council admission, the existing `enforceSignedApprovalAndTagPersona` performs its *separate* signed owner grant and PostgreSQL nonce check. The trusted GitHub App executor still owns reserve-before-write business idempotency under migration `0039_github_idempotent_executions.sql`.
- This particular verifier refuses `owner-overridden` and security-sensitive results, even if signed. Do not treat it as implementation of the separate owner P-256 security exception flow.
- The actual Council signer private key, public-key pin provisioning, and production signed attestation publisher are not configured by this PR. A public-key or nonce-store mock cannot establish production acceptance.
- The current worker returns exceptions at its internal boundary; HTTP 401/403 translation belongs in a separately authenticated API endpoint, which this change does not create.

## Regression tests

`integrations/composio/test/council-attestation.test.mjs` tests valid signatures, untrusted callbacks, foreign key, tampering, exact-head mismatch, expiration, nonce replay, and the fact that Council success alone does not bypass owner-signed authorization. Its PostgreSQL test runs migration 0037 in PGlite and reinitializes the store to verify one-time nonce semantics.

Run via the **existing** `.github/workflows/verify.yml`, which installs the isolated Node >=22.22.3 Composio worker. Do not add a ninth workflow or change the root Node >=20 compatibility contract.

## Remaining independent production acceptance

1. Target Composio **Platform** project key and user connections must be established using protected server-side configuration, not copied from a ChatGPT-hosted Composio integration.
2. A separately trusted Council signing principal must publish a real Ed25519 attestation over the exact head, under an independently configured pinned public key.
3. Durable nonce consumption must be witnessed against the production PostgreSQL ledger; no in-memory fallback.
4. Owner signed grant, GitHub App identity, remote write, and independent readback must pass their own existing authorization gates.
5. The source must clear exact-head CI, review, deployment-manifest parity and independent production canary.

**Disposition:** No real authentication or production write was performed by this source change. PR #442 remains draft/HOLD.
