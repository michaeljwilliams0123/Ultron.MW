<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: f1b33111c7d80539ca4e12f2d7aca5f814f69b142f4e1a8bef304b31fa853a9c
Observed GitHub main SHA: 3755474fc205f60ad1fec7e96577a40fe5a550b9
Observed source tree SHA: 792c7eaaadf1bc46a0e4e77ba3b6c417fe9cc383
Observed at: 2026-11-18T04:28:22.718Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| medium | ci-head-unobserved | Current-main CI conclusion was not independently verified during this scan | Read exact-main GitHub Actions Verify outcome before making a CI claim |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 1094
- Source files: 169
- Test files: 369
- Workflow files: 9
- Static evidence coverage: 1
- Observed current-main CI: not-probed
- GitHub CI evidence run: unavailable

## Static wiring checks

- docs/core/capabilities.mjs: observed
- docs/core/cycle.mjs: observed
- src/cloud-cycle.mjs: observed
- src/cloud-pr.mjs: observed
- .github/workflows/cloud-pr.yml: observed
- .github/workflows/lane-ops-audit.yml: observed
- src/self-scan-pr.mjs: observed
- .github/workflows/owner-comment-router.yml: observed
- src/pr-brain.mjs: observed
- src/ci-evidence.mjs: observed
- src/pr-brain-verify.mjs: observed
- src/pr-brain-model.mjs: observed
- src/pr-brain-safety.mjs: observed
- .github/workflows/verify.yml: observed

## Unverified capabilities (do not treat as healthy)

- Runtime: not-probed
- Provider: not-probed
- Production convergence: not-probed
- Independent learning gain: not-established

## Next steps

- Compare actual realized outcomes against prior predictions before updating policy
- Read exact-main GitHub Actions Verify outcome before making a CI claim
- Run an authenticated end-to-end task and validate its durable result

This PR is a source scan, not a verified code fix.
Proposed repairs require separate tested implementation before closure.
