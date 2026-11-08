# Ultron.MW sole-owner release and grant authority

**Supersedes prospective second-human approval and external independent signer requirements.**
Owner: `michaeljwilliams0123`. This is an operational source policy; it does not
rewrite existing GitHub audit history, immutable database receipts, or third-party
rules. No second human reviewer, co-signer, independent Vault/HSM administrator,
or alternate GitHub account is required to approve an Ultron task or release.

## What authority means

1. **Approval:** An authenticated owner grant or existing scoped standing approval
   is the human decision. Council roles, CodeRabbit, Reef and other evaluators
   provide evidence, suggestions, test results and dissent, not additional human
   signatures. Machine findings may block unsafe effects until remediated.
2. **Signing:** Short-lived delegated MCP grants are signed with an owner-controlled
   P-256 key. The sole owner chooses, stores and uses the private key. The hosted
   worker verifies using only the pinned public JWK. No external co-signing service
   or paid HSM subscription is necessary.
3. **Execution:** GitHub App tokens, Hatchable OAuth and other provider credentials
   are down-scoped worker identities, not separate human authorities. They cannot
   self-authorize an expanded operation, change a profile or mint owner grants.
4. **Evidence:** Keep exact-head CI, nonzero-cost denial, revocation/pause,
   owner identity, operation/resource binding, unique action keys, no-replay
   PostgreSQL receipts, and independent *provider readback*. These are technical
   checks, not approval votes or co-signatures.

## Sole-owner signing — no second person or external signer

Run these commands from the repository checkout with Node 20+ installed. Choose
private/public output paths **outside every repository/worktree**. Use a
protected owner-only directory with OS permissions. The helper refuses
to put private keys inside this checkout and refuses to overwrite an existing
private key. Windows file permissions should additionally be restricted with
the owner's filesystem ACL; POSIX files are created with mode 0600.

```sh
node scripts/owner-grant.mjs init /secure/owner-grant-private.jwk /secure/owner-grant-public.jwk
node scripts/owner-grant.mjs sign /secure/owner-grant-private.jwk /secure/owner-grant-request.json /secure/owner-grant-envelope.json
```

The request JSON contains exactly `actor`, `objectiveId`, `operation`,
`resource`, `administrativeChange`, `policySha`, `profileVersion` and
`stopVersion`. Obtain current profile/stop versions through the authenticated
owner authority API; never guess or disable this binding. The signing helper
adds the fixed issuer `ultron-owner-authority`, `authorizedBy` set to
`michaeljwilliams0123`, a unique grant ID, a five-minute expiry, then verifies
the signature locally before returning an envelope. No private key or secret
scalar appears in the output envelope.

Only the content of the owner **public** JWK belongs in the protected
Hatchable configuration `ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK` when the
owner deliberately provisions it; the private JWK must not go to source control,
GitHub Actions, Hatchable, logs or external integrations. Rotate/revoke the key
and stop the runtime if it is suspected to be compromised. Do not copy owner
private keys between agents.

## GitHub merge and high-impact operations

Verified GitHub API readback on 2026-11-08 showed branch `main` requires
**zero** approving reviews and **does not** require signed commits; it retains
the required `test` status check. The repository reported no rulesets.
Do not add a mandatory external review to this owner-only repository.
A source or workflow change cannot override a future GitHub-hosted rule.

Routine GitHub operations may use standing owner grants. High-impact actions
require the owner's own fresh step-up grant. For PR #200's special security
checkpoint, a verified, automated security evaluation may clear the technical
finding; no separate person's signature is necessary. Missing checks, active
security findings or unclear external write outcomes still prevent release.

The production governance-denial acceptance route intentionally cannot mutate
a PR and does not accept a live owner release grant. It records
`release-mutation-not-authorized` for an otherwise green PR without a release
grant; it no longer tries to find a separate human reviewer. Existing immutable
historical receipts remain auditable, including legacy reason codes.

## Deployment boundary

This change does not deploy new code, provision a key, alter production OAuth,
or authorize paid usage. The observed Hatchable v59 partial migration state
requires rehearsed reconciliation before enabling privileged MCP writes.
After deployment and deliberate owner key provisioning, prove authenticated
`tools/call`, signature and version validation, provider write/readback,
exact durable receipt, replay suppression and immediate pause/revocation.
Keep the approved paid-spend ceiling at **$0**.

For source verification: `node --test test/sole-owner-authority.test.mjs
test/owner-grant-issuer.test.mjs`, then `node scripts/verify.mjs`.
