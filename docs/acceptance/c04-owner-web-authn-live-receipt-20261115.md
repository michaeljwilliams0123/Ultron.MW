# C04 — Owner WebAuthn GitHub PR-comment acceptance receipt

Status: **AWAITING REAL OWNER PASSKEY ASSERTION — NOT ACCEPTED**.

This document is an inspectable witness for the first live execution of the
native C04 owner-passkey path introduced by PR #462. It intentionally remains
in a non-merged pull request while the owner conducts the one-time signed
comment acceptance. It never contains an owner signing key, WebAuthn assertion,
session token, installation token, or raw provider credentials.

## Locked acceptance boundaries

- Canonical owner: `michaeljwilliams0123`; contributor: `michaeljwilliams0123ultron`.
- GitHub repository: `michaeljwilliams0123/Ultron.MW`; immutable repo ID `1424939667`.
- Coordinator GitHub App ID `5633654`; installation `179066535`.
- Canonical owner origin and WebAuthn RP ID:
  `https://ultron-mw-cloud.hatchable.site` and
  `ultron-mw-cloud.hatchable.site`.
- Owner-initiated one-comment scope: a prepared canary must be bound to
  this PR number, a canonical comment-body SHA-256, a fresh passkey challenge,
  the current owner profile/stop versions, and exactly one nonce.
- Owner must explicitly confirm the device's passkey prompt. A source PR review
  or an agent-issued API request does not substitute for that device proof.
- No repeat provider POST after uncertainty. Readback-only reconciliation.
- Paid inference ceiling: $0. No permission elevation, branch-rule bypass,
  new GitHub App, or developer-access credential export.

## Evidence acceptance checks (not yet satisfied)

1. Owner session and enrolled WebAuthn credential verified at the canonical origin.
2. Live canary `status` configured/enabled and repository/target PR
   `diagnose` shows HTTP 200, PR OPEN and unlocked.
3. Pre-action `github_pr_comment_executions` ledger is IDLE for this PR.
4. Browser prepares exact comment and five-minute passkey challenge.
5. Owner explicitly consents via Face ID / Touch ID / Windows Hello.
6. Exactly one GitHub POST authored by the **Coordinator App**, and an
   independently observed GitHub GET of exact comment ID, body, actor, App ID.
7. PostgreSQL exact operation digest and one terminal `completed` receipt
   match that remote comment; no secrets persisted or published.
8. Replayed challenge, stale stop version, revoked credential and wrong PR
   are denied without a second provider side effect.
9. Separate Council 7/7 check is reported truthfully, not overwritten
   by this C04 success. #455 remains separate.

## Source/CI history

- Source implementation: [PR #462](https://github.com/michaeljwilliams0123/Ultron.MW/pull/462)
  merged to `main` at `b596812fe8f8484973041470ee7c1b57075a5292`.
- Owner-account source approval: [review #5909534998](https://github.com/michaeljwilliams0123/Ultron.MW/pull/462#pullrequestreview-5909534998),
  exact head `ed5749e72e81c867dd3165637fb600260648974d`.
  This is not an independent human or hardware passkey authorization.
- Focused C04 regression suite: 25/25 passed; full exact-head engineering
  checks test, fixed-comparison, attested-receipt, Reef and Council debate passed.
- Hatchable release: **v117**; deployment preflight had zero blocking errors.
- Previous attempts on #437, #456 and #457: four reconciled as
  `denied_no_effect`, zero verified provider comments.
- Council source-pinned check still HOLD; do not relabel as success.

The final production-acceptance record must be updated from independently
read-back GitHub and Hatchable/PostgreSQL receipts **after** an actual owner
passkey assertion. Do not check boxes based on this witness alone.
