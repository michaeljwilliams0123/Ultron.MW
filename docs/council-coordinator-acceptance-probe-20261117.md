# Council Coordinator credential and 7/7 acceptance probe — 2026-11-17

This is a reversible, owner-authorized integration-test PR against `main`. It deliberately changes **documentation only**. Do not merge until the full Council workflow evidence has been inspected.

## Acceptance assertions

1. The workflow `.github/workflows/council-required-status.yml` executes trusted `main` code for this PR's exact source SHA and records its independently retrieved base SHA and changed-file context.
2. The `ULTRON_COORDINATOR_PRIVATE_KEY` Actions secret is present and is bound to Coordinator GitHub App ID `5633654` / installation ID `179066535`, not to Builder or Council Gate. Never display or copy key material into PR comments, artifacts, or logs.
3. The Coordinator's GitHub installation token is minted only from the correct App identity when the bounded, owner-authorized live review executor actually needs it. Confirm from trustworthy workflow output, not a mere secret-presence check.
4. Seven role-specific, source-bound attestations are independently verified if the Council role providers are available at the configured $0 paid ceiling. A model-independent deterministic verdict alone must not be described as 7/7 model consensus.
5. The dedicated Council Gate App publishes the `ultron/council-7of7` check with source-SHA binding and an accurate PASS/HOLD conclusion. Missing signatures, model evidence, or credentials remain HOLD.
6. Exact-head core verification, signed receipts, and independent post-run checks are collected. No branch protection or security control is bypassed.

## Scope and cleanup

- No production credentials are added to this repository or to this document.
- No production deployment, merge, or manual privileged PR review is requested by this test.
- Existing Hatchable v124 and Cloudflare staging resources remain unchanged by this PR.
- Keep the PR open until results have been recorded. Afterwards it may be closed without merging.

This document is a trigger and assertion checklist. It is **not** evidence of a successful cryptographic exchange or seven-role approval.
