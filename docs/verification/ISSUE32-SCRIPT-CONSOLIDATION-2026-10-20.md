# Issue #32 — Script consolidation and branch retirement review

Date: 2026-10-20  
Authoritative repository: `michaeljwilliams0123/Ultron.MW`  
Starting `main`: `176cdfefa8611581b66319737b8ef66a42860d6d`  
Scope: source/scripts, workflows, associated test contracts, remote branch ancestry, and exact-head evidence. No provider or infrastructure migration.

## Executive finding

Ultron's rapid growth did not leave a large number of *active* PRs: all preexisting PRs were closed. It did leave a small number of **source-divergent branches with potentially incompatible orchestration and evidence policies**, mixed with historical test, proposal and scan branches. The remedy is source-oriented classification and predictable cleanup, **not** more approval gates or another deployment plane.

The current reliable execution boundary is:
owner-authored task → deterministic admission → bounded model/source proposal → PR-branch write → independent exact-head Verify → either source receipt or one controlled inverse patch on a confirmed failed model change → protected `main` squash merge. The existing GitHub Pages console and cloud Actions remain the only cloud entrypoints.

## Remote branch reconciliation

At inventory there were **13 remote branches**: `main` plus 12 non-default branches. No open PRs were present at that snapshot.

Nine refs were pruned only after checking GitHub `compare_commits`, terminal PR state, and the exact branch SHA. Three of those refs had **zero commits ahead of main** (fully ancestral); six were linked to closed, unmerged and superseded/intentional canary PRs. The complete ref/SHA inventory is preserved in [Issue #32 branch ledger](https://github.com/michaeljwilliams0123/Ultron.MW/issues/32#issuecomment-6301040473). Pruning did not force-push or alter `main`.

A scheduled GitHub self-scan independently created [PR #53](https://github.com/michaeljwilliams0123/Ultron.MW/pull/53) while pruning proceeded. That PR has a report-only diff against the baseline and must be reconciled on its own merits, not silently removed.

### Three feature branches intentionally retained

| Branch | Unique divergence | Disposition |
| --- | --- | --- |
| `feat/authenticated-owner-actuation` | One ahead, 35 behind; older owner operator and observed-learning modules with server integration | **Retain for comparison only.** Current main already has bounded owner action and feedback pathways. Copy only behaviors that demonstrably improve verified semantics. |
| `feat/dissent-heartbeat-lift` | Two ahead, 14 behind; standalone dissent/evidence reconciliation and bounded heartbeat-ledger modules/tests | **Retain pending integration proof.** No verified end-to-end caller demonstrates an operational benefit; do not bulk lift Mahoraga-style hierarchy. |
| `feat/velocity-mode-85` | Four ahead, five behind; alternate proof-safety and CI-evaluation logic | **Do not merge as-is.** Its advisory Verify path can return `ok:true` after non-success/timeout, and its source preflight can warn rather than reject altered capability-proof paths. Both contradict the current release evidence boundary. |

No retained feature branch should be auto-merged solely because its own tests pass; tests written against old branches cannot prove compatibility with current `main`.

## Script and workflow findings

| Severity | Source | Observed script behavior | Action |
| --- | --- | --- | --- |
| P0 incompatible branch | `feat/velocity-mode-85/src/pr-brain-verify.mjs` and `src/pr-brain-safety.mjs` | Alternate velocity mode reports some unsuccessful Verify outcomes as allowed; capability-proof modification may be warning-only | Keep this branch quarantined; preserve hard release checks and require evidence-based comparison before salvaging throughput features |
| P1 confirmed | `src/pr-brain.mjs` | Model-generated source edits have one inverse-patch rollback on independently observed failed Verify; `@ultron patch` path dispatches Verify but does **not** share that recovery function | Consolidate into one owner/model recovery helper with exact-head lease and restored-head check; regression for failure, pending, action_required and no-repeat |
| P1 confirmed | `src/self-scan-pr.mjs` | `selfScanSignature()` includes `report.inventory` and `report.uncertainty` despite claiming material-finding-only deduplication. A harmless increase in file count changes the signature and launches an otherwise redundant scan PR | **Repaired by this PR:** fingerprint only source-route evidence and actual weaknesses; preserve counts/CI/runtime details in report text |
| P1 evidence caveat | `src/self-observer.mjs` | Source scan always identifies live operational execution as not observed even after a separately verified hosted objective ran. This is **conservative**, not proof of a runtime defect | Preserve distinct source-vs-live truth, then add a receipt-backed status adapter if its exact-main signature/actor can be independently verified |
| P2 misleading metric | `scripts/ci-observability-snapshot.mjs` | The summary counts successful/failed **all completed runs on main** rather than solely the core Verify workflow at the authoritative SHA. Those figures are not necessarily current-main regression pass/fail metrics | Clearly label broad workflow history, or reuse strict `readVerifiedMainCi` semantics for authoritative core-check status |
| P2 cohesion | `src/cloud-pr.mjs`, `src/code-pr.mjs`, `src/pr-brain-patch.mjs`, `src/framework-builder.mjs` | Multiple mutation entrypoints exist because they perform distinct owner issue, PR comment, and generated template workflows | Keep actual separate entry contracts; centralize only common evidence/lease code after source regression testing, not by deleting execution lanes indiscriminately |
| P2 local/global distinction | `src/always-on.mjs` and `.github/workflows/self-scan-pr.yml` | Local standby is deterministic and advisory; hourly GitHub self-scan is ephemeral. Neither implies a continuously running cloud brain | Preserve truthful UI copy, no idle-paid-provider or false always-on claims |

### Existing contracts preserved

- Exactly one required `test` check, with admin enforcement and up-to-date base, linear history, and force-push/deletion restrictions.
- GitHub Actions `verify.yml` pins reviewed checkout/setup-node releases, a clean no-scripts install, a production dependency vulnerability audit, a Transformers import smoke check, actionlint, syntax checks and the repository regression suite.
- PR comment brain admits owner-authored PR comments only, uses exact branch head, and independently reads GitHub Verify terminal outcomes.
- Generated API/MCP templates do not automatically mint third-party credentials or deploy services.
- Public CPU model output remains bounded and provenance-distinct from deterministic patches; no implied general-purpose autonomy or demonstrated learning improvement.

## This PR: one material noise reduction

`selfScanSignature(report)` now hashes **only** observed source-route evidence and current weaknesses, not inventory totals or non-finding status metadata. The audit report still records the real scanned SHA, file counts, source counts, CI evidence, and unknown runtime status.

The new regression tests explicitly require:
1. Adding harmless source/test files and advancing observation time does **not** create another self-scan PR for identical findings.
2. A regression in actual route evidence changes the signature and remains actionable.
3. Existing tests still prove new weaknesses update the one open findings PR, with no Issue creation.

This suppresses PR churn without disabling autonomous scanning or hiding real defects. It does **not** assert that a past self-scan artifact's source SHA is current merely because the finding signature remains unchanged.

## Decision model to prevent Mahoraga-style architecture sprawl

1. **One objective → one accountable change surface:** prefer a script repair and its tests over introducing a new brain, queue, provider, platform or policy tier.
2. **Prove behavior before promotion:** count independently linked Verify passes, real rollback outcomes and user-visible execution, not source assertions or synthetic cognitive outputs.
3. **Retire obsolete branch refs after evidence recording:** associate PR state and original SHA, preserve divergent feature work, and never delete open PR branches opportunistically.
4. **Govern by verified boundaries, not bureaucracy:** one native PR review/CI path; keep core identity, secret, branch, rollback and paid-spend limits; remove duplicate controls only when they are provably redundant.
5. **Make growth measurable:** prefer observed objective completion, regression/rollback rate, CI latency and false-positive scan PR count. A benchmark without a real outcome remains unverified.
6. **Keep the single console:** native GitHub Pages + Actions already execute cloud tasks without a workstation; defer external hosts or paid providers unless an acceptance scenario conclusively needs them.

## Completion gates

Before squash merge: independently check exact PR head, that the updated source and regression tests are the only functional changes, green required `test`, no unexpected workflow/security policy edits, and branch not behind main. After merge: independently verify the new current-main Verify and Pages deployment, and post final SHAs to Issue #32.

This is scoped **within Issue #32**. The remaining native Pages end-user mobile/browser acceptance and shared patch rollback are separate explicit acceptance/implementation items. Do not close Issue #32 as part of this housekeeping change.
