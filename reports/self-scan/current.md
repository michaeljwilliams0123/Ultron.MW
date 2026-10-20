<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: 386065a0cac6f5ac1dd05ea8ad5e194f27cc733763d10fdd17ba7b41e74fe0f0
Observed GitHub main SHA: 51140b441ebffcf7e876c3b1c21810dc9491912f
Observed source tree SHA: 4e0fce64fe4efd1548b90729e5cf95f919d95658
Observed at: 2026-10-20T17:14:43.453Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 120
- Source files: 35
- Test files: 44
- Workflow files: 5
- Static evidence coverage: 1
- Observed current-main CI: success
- GitHub CI evidence run: https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39437188259

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
