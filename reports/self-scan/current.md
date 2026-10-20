<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: 4eacc2600b68df1a30aa2e7ff70052af60d73563935991fddf2fd11d3602bb91
Observed GitHub main SHA: 2e381354b4875858a5e3f57f53eb07f4937f1081
Observed source tree SHA: 6668249c757fd9850366c0a9bdc7113cdd6d7e52
Observed at: 2026-10-20T06:05:56.485Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| high | ci-head-failing | Exact-main GitHub Verify completed: failure | Repair the failed or blocked check and independently rerun Verify |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 89
- Source files: 28
- Test files: 34
- Workflow files: 5
- Static evidence coverage: 1
- Observed current-main CI: failure
- GitHub CI evidence run: https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39363150830

## Static wiring checks

- docs/core/capabilities.mjs: observed
- docs/core/cycle.mjs: observed
- src/cloud-cycle.mjs: observed
- src/cloud-pr.mjs: observed
- .github/workflows/cloud-pr.yml: observed
- .github/workflows/cloud-objective.yml: observed
- .github/workflows/self-scan-pr.yml: observed
- src/self-scan-pr.mjs: observed
- .github/workflows/pr-brain.yml: observed
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
- Repair the failed or blocked check and independently rerun Verify
- Run an authenticated end-to-end task and validate its durable result

This PR is a source scan, not a verified code fix.
Proposed repairs require separate tested implementation before closure.
