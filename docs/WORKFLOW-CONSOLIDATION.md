# Workflow consolidation: 26 legacy workflows into 8 Council lanes

**Status:** phase 1 (shadow). Owner-approved direction (Nov 10, 2026: "Yes, 26 to 8").
No legacy workflow is deleted, renamed, disabled or edited in this phase. The
required check `test` in `verify.yml`, rulesets, secrets and variable names
are unchanged.

Source of truth: `src/workflow-consolidation.mjs` (manifest),
`src/workflow-lane-rules.mjs` (lane bug fixes), `scripts/workflow-shadow.mjs`
(shadow replay), `test/workflow-consolidation.test.mjs` (parity contract).

## The 8 lanes

| Lane | Owner | Lane file (phase 1, shadow) | Legacy workflows it absorbs |
| --- | --- | --- | --- |
| ci | Skeptic | `lane-ci.yml` | `verify.yml` (anchor), `reef-runtime-probe.yml` |
| comment-router | Companion | `lane-comment-router.yml` | `owner-comment-router.yml` (anchor), `codex-trigger-audit.yml`, `inline-pr-chat.yml`, `pr-brain.yml` |
| council | Steward | `lane-council.yml` | `council-debate.yml` (anchor), `continuum-council-supervisor.yml`, `council-identity-proof.yml`, `council-principal-proof.yml` |
| owner-canary | Predictor | `lane-owner-canary.yml` | `owner-actions-canary.yml`, `owner-canary-matrix.yml`, `mahoraga-connection1026.yml` |
| lab-evidence | Generator | `lane-lab-evidence.yml` | `hf-free-cpu-tournament.yml`, `hf-heldout-cpu.yml`, `hf-oidc-bridge.yml` (anchor), `held-out-acceptance.yml` (anchor), `c06-owner-model-release.yml` (anchor), `c06-reconcile-publish.yml` (retire) |
| ops-audit | Sentinel | `lane-ops-audit.yml` | `live-acceptance-audit.yml`, `self-scan-pr.yml`, `gitlab-mirror.yml` |
| cloud-handoff | Builder | `lane-cloud-handoff.yml` | `cloud-objective.yml`, `cloud-pr.yml` (anchor), `council-worker.yml` (anchor) |
| governed-task | Ultron Core | `lane-governed-task.yml` | `governed-execution.yml` (retire) |

All 35 legacy jobs map to exactly one lane; the parity test fails if a job is
added, renamed or left unmapped.

## What "shadow" means here

Each lane file has one read-only job (`contents: read`, `actions: read`) and
only `workflow_dispatch` (plus one daily all-lane run in `lane-ops-audit.yml`).
It re-checks static parity and replays the legacy runs of its lane through the
lane rules, then writes a step summary. It never comments, labels, dispatches,
reruns or pushes. It never defines a job called `test`, so it cannot satisfy or
shadow the required check. Cost: one short run per day plus any manual runs.

First replay (comment-router, last 14 days, run locally through `gh`):
legacy red runs **36**, lane would report red **4**. The other 32 were
unadmitted PR comments (would be skipped), one `/codex run` with nothing
admitted (neutral) and four runs where GitHub created no jobs (rerun once).

## Bugs fixed in the lanes (not in the legacy files)

1. **pr-conversation fails on unadmitted PRs.** `pr-brain.mjs` exits 1 with
   "Unadmitted PR cannot access Ultron brain" for owner comments on `ultron/`
   PRs without an Ultron marker (~99 lifetime red runs). The lane runs
   `scripts/pr-conversation-preflight.mjs` first and skips the job. The
   admission rule is contract-tested against `handlePrConversation`.
2. **codex-trigger-audit shows a red X when nothing was admitted.** The audit
   stays fail-closed (no executor claim, no retry), but the lane reports it as
   `neutral` instead of a failure.
3. **Missing-jobs runs (#351 pattern)** are reported as "rerun the whole
   workflow once" rather than red.

## Load-bearing workflow identities (why some files are anchors)

These legacy paths are trusted by code outside the workflow file. Renaming
them breaks a live connection, so their lane jobs fold *into* them:

- `verify.yml`: Sigstore receipt signer ref, Hatchable `mahoraga-actions.js`
  dispatch/readback, #351 job-presence classifier, `workflow_run` by name in
  `gitlab-mirror.yml` and `live-acceptance-audit.yml`, and the required check `test`.
- `owner-comment-router.yml`, `council-debate.yml`, `cloud-pr.yml`,
  `council-worker.yml`: Hatchable OIDC trust pins in
  `cloud/hatchable/lib/council-oidc.js` (`...@refs/heads/main`).
- `hf-oidc-bridge.yml`, `held-out-acceptance.yml`, `c06-owner-model-release.yml`:
  Hatchable evidence pins (`github-oidc-bridge.js`, `heldout-evidence.js`,
  `c06-live-evidence.js`).

Without a Hatchable change the end state is **11 files** (8 lanes, three of
which keep more than one pinned file). With a coordinated Hatchable pin update
and deploy it is **8 files**. `cutoverFileCount()` computes both.

## Retirement checklist (owner sign-off per lane)

Follows the controlled procedure in `docs/governance/RETIREMENT-REGISTER.md`
(inventory, contract, replacement, canary, rollout, postcondition, rollback).
Do one lane per PR. Suggested order: governed-task, owner-canary, ops-audit,
lab-evidence, cloud-handoff, council, comment-router, ci (riskiest last).

For each lane:

- [ ] Shadow replay for that lane has run for at least 7 days and shows no
      unexplained difference from the legacy runs.
- [ ] Owner signs off on this lane in the PR (Michael).
- [ ] Move the legacy jobs into the lane target file (the anchor if there is
      one, else `lane-<lane>.yml`) byte-for-byte, then add the legacy triggers.
      Restrict each job with `github.event_name`/`github.event.action` so a
      merged trigger list never fires a job on an event its legacy file did
      not subscribe to.
- [ ] Namespace colliding `workflow_dispatch` inputs (owner-canary: `mode`,
      `expected_sha`, `approval_phrase`) and keep the scripts' env names.
- [ ] Move workflow-level `permissions` and `concurrency` onto each job
      (suffix the job id to concurrency groups so jobs don't cancel each other).
- [ ] Keep `verify.yml` named "Ultron core verification", keep its `run-name`
      (repair correlation) and keep job `test` (required check).
- [ ] Update `workflow_run` name lists (`gitlab-mirror`, `live-acceptance-audit`,
      `hf-oidc-bridge`), dispatch-by-filename callers (`continuum-council-supervisor`,
      `src/pr-brain.mjs`, `src/self-scan-pr.mjs`, `src/code-pr.mjs`,
      `src/cloud-pr.mjs`), `src/self-observer.mjs`, `src/route-reference-audit.mjs`
      and the local reusable-workflow allowlist in `test/workflow-security.test.mjs`.
- [ ] If an OIDC-pinned path moves: deploy the Hatchable pin change first,
      accept both old and new refs for one release, then move the workflow.
- [ ] Delete the absorbed legacy file in the same PR, update the manifest
      (`disposition`), and confirm the next live run on main.
- [ ] Rollback: revert the PR. Legacy files come back unchanged.

Retire candidates (`c06-reconcile-publish.yml`, `governed-execution.yml`) have
no recorded runs. Delete them only after sign-off; `hf-oidc-bridge.yml` has never
succeeded and should be repaired or explicitly retired, not silently dropped.

## Running the shadow replay

- GitHub: Actions → any "Lane … (shadow, …)" workflow → Run workflow.
- Locally (read-only, uses the authenticated `gh` CLI):
  `node scripts/workflow-shadow.mjs --lane comment-router --days 14 --gh`
