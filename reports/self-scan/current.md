<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: 45b6aefcd5b6697fe6e614d22f97e90eee9d7da6411906ba533cf32fe4c46590
Observed GitHub main SHA: 176cdfefa8611581b66319737b8ef66a42860d6d
Observed source tree SHA: 2a2236e985bf9d44e57b69a7c7a517baf3d73f8f
Observed at: 2026-10-20T20:41:04.529Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 123
- Source files: 35
- Test files: 44
- Workflow files: 5
- Static evidence coverage: 1
- Observed current-main CI: success
- GitHub CI evidence run: https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39489337126

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
- Run an authenticated end-to-end task and validate its durable result

This PR is a source scan, not a verified code fix.
Proposed repairs require separate tested implementation before closure.
