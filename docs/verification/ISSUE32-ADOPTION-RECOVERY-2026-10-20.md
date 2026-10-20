# Ultron Issue #32 — selectively adopt, repair, and consolidate historical feature branches
Date: 2026-10-20

## Source authority

Base: `main` @ `83d1d271fb070aa8f743f63f1eb6d680c487b314`.
This tranche **does not** merge any historical branch wholesale. Each adoption is bounded to one existing contract, tested against current main, and has a clear caller.

## Adoptions and repairs

### 1. One reversible PR mutation path

`src/pr-brain.mjs` now uses **one** exact-head failure recovery function for:
- Pinned public CPU `@ultron implement` / `implement files` patches
- Explicit owner `@ultron patch` JSON manifests

After a source commit, the original PR job requests and independently reads back exact-head Verify. Only `state=completed`, `conclusion=failure`, with **matching** exact head SHA authorizes **one inverse-patch commit**, not a force-update or direct main write. The inverse manifest is bound to the original head and the ordinary `applyPrPatch` admission rules; a changed/behind-main branch cannot silently be reverted. Ultron independently verifies the restored head and posts success, failure or pending in the same conversation. `action_required`, `cancelled`, `timed_out`, `neutral`, `skipped`, mismatched SHA, and pending checks are not treated as an established source defect and never become success.

This addresses the live discrepancy proven in [Issue #32's PR #52](https://github.com/michaeljwilliams0123/Ultron.MW/pull/52): the CPU model's intentionally broken candidate failed in [run 39490698831](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39490698831), was restored in one new commit, and passed independent [run 39490761185](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39490761185). The separate owner patch failed in [run 39491009990](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39491009990), but previously had no shared rollback.

### 2. Throughput-only velocity adaptation

Historical `feat/velocity-mode-85` contains useful larger multi-file work budgets, **but also** a dangerous advisory `ok:true` for non-success CI / timeouts and a proof-registry mutation warning bypass. Neither bypass is adopted.

The new `src/capacity.mjs` provides **only** source-generation throughput parameters: default 2–4 explicit files (18 KB combined), optional `ULTRON_CAPACITY=expanded` allowing 2–6 explicit files (22 KB combined), unchanged 6500-byte per-file maximum, unchanged 300-character objective and maximum 22 KB patch manifest. The GitHub PR conversation workflow reads only a repository variable for that option; it does not alter GitHub permissions, the release check, syntax preflight, self-scan evidence, or model authorization. No new model or paid inference provider is introduced. Expanded-mode latency and end-to-end CPU success are not implied by parameter tests alone.

### 3. Bounded standby heartbeat adoption

Historical `feat/dissent-heartbeat-lift` contained a reusable duplicate-suppressing heartbeat reducer. `src/heartbeat-ledger.mjs` now carries a **64-receipt local in-memory bound**, validates the evidence format and requires finite nonnegative counters. `src/server.mjs` integrates the reducer with the **existing** local `/api/standby` endpoint, recording the initial tick and subsequent 60-second standby ticks. The readout is a factual audit window, not a new autonomy lane, cloud daemon, persistent storage claim, or evidence of nonzero model inference.

The historical collective-dissent hierarchy was **not** copied: it currently lacks a justified consumer in the main decision/feedback flow. Creating overlapping councils before an outcome benchmark would recreate Mahoraga's governance sprawl.

### 4. Owner-action and evidence-learning reuse

Historical `feat/authenticated-owner-actuation` already overlaps current `src/action-gateway.mjs`, `src/experience.mjs`, `src/cloud-feedback.mjs` and `src/cloud-pr.mjs`. The old workspace-note/GitHub-draft code and a heuristic action-suggestion model are **not** copied wholesale. Current main already has verified owner action receipts, native GitHub workflow dispatch and a held-out feedback acceptance rule; a second source of identity, permissions or scoring would be organizational regression. Preserve old branch until a narrow improvement with independent evidence is isolated.

### 5. Existing self-scan repair is retained, not replicated

[PR #54](https://github.com/michaeljwilliams0123/Ultron.MW/pull/54) is already merged. `src/self-scan-pr.mjs` fingerprints **material route evidence and weaknesses**, not ordinary file-count changes. The existing regression stays required. This PR does not recreate or modify that publisher.

## Acceptance, release and remaining gap

Run clean locked dependency installation, vulnerability audit, syntax/actionlint, all regression tests, and exact-head GitHub `test`. Confirm required checks and up-to-date branch state before any protected squash merge. After merge, independently inspect current-main CI and matching Pages deployment at the resulting SHA.

**Remaining under Issue #32:** independent authenticated user interaction with the live GitHub Pages UI on mobile/browser, and genuine measured learning/quality improvement. GitHub Actions success is not itself a browser interaction. No AGI, autonomy or production browser claim should be substituted for an observed result.

Reference: [Issue #32](https://github.com/michaeljwilliams0123/Ultron.MW/issues/32).
