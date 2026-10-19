<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: 547b21775509c88de334651bcb3d3f4d985a3e26c8db008360c11bbc8ed40d1b
Observed GitHub main SHA: ee1080712f550d9dd794be3ebf2805bdfca7ef4c
Observed source tree SHA: 047ee6165879777c7d362686d065ad4f059655e2
Observed at: 2026-10-19T22:11:00.776Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| medium | ci-head-unobserved | Current-main CI conclusion was not independently queried during this scan | Verify the exact source SHA in GitHub Actions before making a CI claim |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 67
- Source files: 19
- Test files: 26
- Workflow files: 4
- Static evidence coverage: 1

## Static wiring checks

- docs/core/capabilities.mjs: observed
- docs/core/cycle.mjs: observed
- src/cloud-cycle.mjs: observed
- src/cloud-pr.mjs: observed
- .github/workflows/cloud-pr.yml: observed
- .github/workflows/cloud-objective.yml: observed
- .github/workflows/self-scan-pr.yml: observed
- src/self-scan-pr.mjs: observed
- .github/workflows/verify.yml: observed

## Unverified capabilities (do not treat as healthy)

- Runtime: not-probed
- Provider: not-probed
- Production convergence: not-probed
- Independent learning gain: not-established

## Next steps

- Compare actual realized outcomes against prior predictions before updating policy
- Run an authenticated end-to-end task and validate its durable result
- Verify the exact source SHA in GitHub Actions before making a CI claim

This PR is a source scan, not a verified code fix.
Proposed repairs require separate tested implementation before closure.
