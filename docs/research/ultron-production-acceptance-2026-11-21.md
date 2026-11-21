# Ultron MW production acceptance — primary-evidence research (2026-11-21 UTC)

## Scope and constraints
Canonical repo: `michaeljwilliams0123/Ultron.MW`; Hatchable project `proj_A6GCXRSKizko`. No credentials or secret values were accessed. No production provider write, grant, key, paid model, or Cloudflare ingress activation is authorized by this research.

## Observed primary evidence
- Exact GitHub `main` SHA from GitHub Git-ref API and a clean isolated local checkout: `3cad23a429d00426fe48a752d73d30c0aafdbb94` (commit time 2026-11-21T23:08:03Z; PR #519).
- Hatchable deployment inventory: **v142 live**, deployed 2026-11-21T23:09:09Z, **267 files / 59 functions**.
- Independent SHA-256 comparison of all **267 v142 manifest file hashes** against `cloud/hatchable/` in the exact-main checkout: **267 exact; 0 missing, 0 differing, 0 LF exceptions**. Frozen manifest: `docs/research/ultron-v142-manifest-sha256.json`. Reproduce with `node scripts/verify-deployed-source-parity.mjs docs/research/ultron-v142-manifest-sha256.json cloud/hatchable` on exact `3cad23a` checkout. Canonical manifest digest: `sha256:589901a0f1ee17cbcec4a8e41fa6a5238fe047859ac96d5c6ed235a61874cfea`. This is byte parity, **not** a signed release receipt or authorization.
- Live owner-only `GET /api/brain/release-proof`: HTTP 200, `verified=false`, `status=unverified-drift`. `ci.verified=true` (run #44960268686), `council.verified=true` (7/7 Gate App check #137017079840, PR #519), `deployment.verified=false`; missing `signed-deployment-receipt` and `independent-manifest-readback` in the product's current release proof. Anonymous GET returned 401.
- PostgreSQL `brain_deployment_release_receipts`: **one** prior immutable record for **v140**, source `5ce80490cb57116b36da94de0aab0e4db67edbd1`, receipt #1, created 2026-11-21T21:40:23.725321Z. This is not v142 attestation.
- Live owner C04 PR #447 status GET 200 `idle`, anonymous 401; `brain_signed_inbox=0`, `brain_omni_execution_state=0`, and `github_pr_comment_executions` target #447 = **0**. PR #447 and #453 are merged; #447 is not an eligible *open* PR for new C04 writes.
- Live owner Cloudflare edge-health GET 200; `ingressAccepting=false`, `executionAuthorized=false`. Cloudflare provider queue/consumer counts and unsigned staging 503 were not refreshed during this investigation.
- GitHub issue #285 currently **closed** (closed by repository owner 2026-11-15T03:35:09Z), despite issue text explicitly retaining more acceptance gates. Do not infer acceptance from administrative closure.

## Offline regression execution
- New deterministic safety test: 16,384 distinct cases across six parameterized test groups; six groups passed in approximately 0.58s. Added five TDD RED→GREEN offline source-parity CLI regressions (all PASS). These are code-level vectors, **not** 16,384 independently executed production mutations.
- Existing non-PostgreSQL repair/Council tests: 28 PASS; mirror parity 19/19. One PostgreSQL-backed test file could not load in isolated worktree due to missing `@electric-sql/pglite`; npm dependency installation was blocked by the host's `EALLOWSCRIPTS` policy. Do not report its tests as failed.

## Research conclusions and external standards
1. A deployment manifest plus source parity is necessary evidence of fidelity, but a release gate requiring a **signed, immutable, owner-authorized receipt** remains unfulfilled. GitHub's first-party artifact attestation documentation describes provenance and digest-bound verification: https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations
2. A GitHub PR timeline comment uses the **issue-comment API**; a real external C04 effect needs independent author/body and immutable ledger readback. API: https://docs.github.com/en/rest/issues/comments
3. Node's built-in runner supports deterministic tests without an external paid model: https://nodejs.org/api/test.html
4. Issue contracts #167 (operator), #168 (self-repair), #170 (UI), #173 (independent Reef) require distinct production/provider proofs. #173 remains an independent evaluation gate; deterministic Council roles or passing CI are not evaluator certification.
5. **Do not** resolve #285 by synthesizing a local receipt, changing `verified` or treating tests as a production write. Finish the authenticated owner step-up and readback through the existing application; use a currently open PR, never merged #447.

## Evidence URLs
- https://github.com/michaeljwilliams0123/Ultron.MW/commit/3cad23a429d00426fe48a752d73d30c0aafdbb94
- https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/44960268686
- https://github.com/michaeljwilliams0123/Ultron.MW/issues/285#issuecomment-6885219023
- https://ultron-mw-cloud.hatchable.site
