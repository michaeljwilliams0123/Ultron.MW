# Workflow cheat-sheet: old names → new names (26 → 8)

For manual dispatches after the consolidation (#418). Every run is on `main`.
The old files are deleted: dispatching them fails. Passing an input that a file
does not declare (for example the old `mode`) is rejected by GitHub (HTTP 422).

| Old workflow (retired) | Run now | Selector | Renamed inputs |
| --- | --- | --- | --- |
| `verify.yml` | `verify.yml` (unchanged) | — | — |
| `owner-comment-router.yml` | `owner-comment-router.yml` | comments, as before | — |
| `pr-brain.yml` | `owner-comment-router.yml` job `pr-conversation` | PR / review comments, as before | — |
| `codex-trigger-audit.yml`, `inline-pr-chat.yml` | `owner-comment-router.yml` | comments, as before | — |
| `cloud-objective.yml` | `owner-comment-router.yml` job `cloud` | issue `[Ultron Cloud] Objective`, or dispatch | `objective` (unchanged) |
| `council-debate.yml` | `council-debate.yml` | `council_task=debate` (default) | `item_number` is now optional |
| `council-identity-proof.yml` | `council-debate.yml` | `council_task=identity-proof` | `role`, `issue_number` (unchanged) |
| `council-principal-proof.yml` | `council-debate.yml` | `council_task=principal-proof` | — |
| `continuum-council-supervisor.yml` | `lane-ops-audit.yml` job `reconcile` (hourly :19 UTC) | `ops_task=continuum-supervisor` | — |
| `owner-actions-canary.yml` | `lane-owner-canary.yml` | `canary_task=owner-actions-canary` | `mode` → `actions_mode` (`read`/`create`) |
| `owner-canary-matrix.yml` | `lane-owner-canary.yml` | `canary_task=owner-canary-matrix` | `mode` → `matrix_mode` (`inspect`/`verify`/`marker`) |
| `mahoraga-connection1026.yml` | `lane-owner-canary.yml` | `canary_task=mahoraga-connection1026` | `mode` → `connection_mode` (`read`/`write-canary`) |
| `hf-heldout-cpu.yml` | `lane-lab-evidence.yml` | `lab_task=hf-heldout-cpu` | — |
| `hf-free-cpu-tournament.yml` | `lane-lab-evidence.yml` | `lab_task=hf-free-cpu-tournament` | — |
| `c06-owner-model-release.yml` | `lane-lab-evidence.yml` | `lab_task=c06-owner-model-release` | `objective` (unchanged) |
| `held-out-acceptance.yml` | `lane-lab-evidence.yml` | `lab_task=held-out-acceptance` | `baseline_sha`, `candidate_sha` (unchanged, both required) |
| `live-acceptance-audit.yml` | `lane-ops-audit.yml` job `audit` | `ops_task=live-acceptance-audit` | — |
| `self-scan-pr.yml` | `lane-ops-audit.yml` job `self-scan-pr` | `ops_task=self-scan-pr` (default) | — |
| `gitlab-mirror.yml` | `lane-ops-audit.yml` job `mirror` (after Verify on main) | `ops_task=gitlab-mirror` | — |
| `reef-runtime-probe.yml` | `lane-ops-audit.yml` job `reef-runtime-probe` | `ops_task=reef-runtime-probe` | — |
| `council-self-repair.yml` | `lane-ops-audit.yml` jobs `diagnose`, `act` | `ops_task=council-self-repair` | `run_id` (unchanged) |
| `council-worker.yml` | `lane-governed-task.yml` (worker only) | issue or dispatch, as before | `request` (unchanged) |
| `cloud-pr.yml` | `cloud-pr.yml` (unchanged) | — | — |
| `hf-oidc-bridge.yml`, `c06-reconcile-publish.yml`, `governed-execution.yml` | retired, no replacement | — | — |

Owner canary inputs shared by all three tasks: `expected_sha`, `target_run_id`,
`marker_run_id`, `approval_phrase` (same meaning as before).

## Copy-paste

```
gh workflow run council-debate.yml -f council_task=identity-proof -f role=BUILDER -f issue_number=<n>
gh workflow run council-debate.yml -f council_task=principal-proof
gh workflow run lane-owner-canary.yml -f canary_task=owner-actions-canary -f actions_mode=read
gh workflow run lane-owner-canary.yml -f canary_task=owner-canary-matrix -f matrix_mode=inspect -f target_run_id=<id> -f expected_sha=<sha>
gh workflow run lane-owner-canary.yml -f canary_task=mahoraga-connection1026 -f connection_mode=read
gh workflow run lane-lab-evidence.yml -f lab_task=hf-heldout-cpu
gh workflow run lane-lab-evidence.yml -f lab_task=c06-owner-model-release
gh workflow run lane-lab-evidence.yml -f lab_task=held-out-acceptance -f baseline_sha=<sha> -f candidate_sha=<sha>
gh workflow run lane-ops-audit.yml -f ops_task=self-scan-pr
gh workflow run lane-ops-audit.yml -f ops_task=continuum-supervisor
gh workflow run owner-comment-router.yml -f objective='<one-line read-only objective>'
gh workflow run lane-governed-task.yml -f request='<worker request JSON>'
```

Source of truth for the mapping: `src/workflow-consolidation.mjs`; background in
[WORKFLOW-CONSOLIDATION.md](WORKFLOW-CONSOLIDATION.md).
