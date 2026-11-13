# Omni Shadow Execution Evidence — migration 0047

**State:** additive source-only candidate. Not deployed. No GitHub mutations, no paid inference, no new owner-grant issuance.

## Why a shadow implementation

The canonical repo already has durable intent/receipt systems: 0013 Continuum outbox, 0028 Council execution ledger,
0039 branch writes, 0041 PR comment writes, and 0045 deep mutation ledger. A separate executing transport
would duplicate authority and bypass protected evidence. The 0047 scope is a read/advisory-only, inert evidence
layer for testing lifecycle integrity before independently reviewed integration.

## States and acceptance

RECEIVED -> PERSISTED -> AUTHORIZED -> EXECUTED_AND_VERIFIED; an uncertain authorized outcome transitions
to RECONCILE_REQUIRED, with verified completion only after a fresh independent provider readback.
FAILED_TERMINAL is terminal for denied/failed paths. Terminal and audited transitions cannot be rewritten.

Admission uses sorted-key canonical JSON SHA-256 from src/git-hubs.mjs, snapshots caller data once,
and uses INSERT ON CONFLICT(nonce) DO NOTHING with immutable readback. A replay with a different payload
or repository/source/effect is explicitly rejected, never silently updated.

Authorization is separate from advisory Council votes. It uses domain-separated P-256 ECDSA signatures
over exact event ID, nonce, payload digest, canonical repository, source SHA, grant ID and expiry.
The SQL trigger additionally requires a matching live brain_authority_grants row. This is not a
replacement for WebAuthn, Trusted Council check 7/7 or an externally pinned production owner key.

Verification in source requires an explicitly injected provider-readback callback; no default provider
verifier, GitHub API token, browser context or webhook handler is created. The callback is a test seam,
not independent evidence unless its production implementation is separately verified.

The advisory signatures table accepts unverified evidence but confers no quorum authority. It is NOT
a threshold signature scheme: uniqueness of public-key fingerprints cannot establish genuine keys,
distinct operators or valid signatures.

## Dynamic tool registry

Candidate manifests are stored for static evaluation only. is_active has DEFAULT FALSE plus a
database CHECK that prevents activation. No generated code is hot-loaded into Hatchable or another
worker; tool activation needs separate source review, sandbox evidence, owner authorization and release gates.

## Tests

Run node --test test/omni-shadow-state-machine.test.mjs against disposable PGlite 0.5.15.
Tests cover full advisory lifecycle, canonical replay, changed nonce payload, source scope,
direct SQL transition skipping, terminal immutability, seven unverified advisory signatures,
real P-256 grant signatures, expired/tampered grants, provider readback denial, and inert tool manifests.

Do not apply 0047 to production or enable new routes merely because CI is green. The outstanding
Council App, credential custody, owner passkey and provider-receipt acceptance checks remain mandatory.
Release changes require a separate reviewed PR and an authorized end-to-end mutation canary.
