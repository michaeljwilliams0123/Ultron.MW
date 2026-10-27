<!-- ULTRON_SELF_SCAN_REPORT_V1 -->
# Ultron self-scan — actionable source findings

Finding signature: b7885086a40f393dbd2553571295419657d5a4e5a759db1241f5b5a9ed7806a4
Observed GitHub main SHA: d9450aceb89e21e8d63e73e935b59eb867673f63
Observed source tree SHA: 8b6b97484692ec781843cc3c5853b62b30664f5c
Observed at: 2026-10-27T19:27:02.455Z
Authority: exact GitHub main, not a deployed production runtime

## Findings

| Priority | Code | Evidence | Suggested next action |
| --- | --- | --- | --- |
| high | live-execution-unobserved | Source inspection cannot attest a production request or response | Run an authenticated end-to-end task and validate its durable result |
| medium | learning-effect-unobserved | The scan has no independently scored future-task or held-out cognition outcome | Compare actual realized outcomes against prior predictions before updating policy |

## Scanned source

- Files inventoried: 306
- Source files: 59
- Test files: 93
- Workflow files: 8
- Static evidence coverage: 1
- Observed current-main CI: success
- GitHub CI evidence run: https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/40566204326

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
