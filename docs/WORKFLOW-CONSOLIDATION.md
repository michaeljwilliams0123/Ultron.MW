# Workflow consolidation: 26 legacy workflows into 8 Council lanes

**Status:** phase 2 (live). Owner decision (Nov 10, 2026: "Get to the 8, redeploy
cleanly"). Exactly eight workflow files remain in `.github/workflows/`. The
required check `test` is still produced by job `test` in an unchanged
`verify.yml`. Rulesets, branch protection, secrets and variable names are
unchanged.

Source of truth: `src/workflow-consolidation.mjs` (manifest and parity check),
`test/workflow-consolidation.test.mjs` (parity contract),
`test/workflow-lane-view.mjs` (lets the per-workflow tests read a moved job in
its lane file).

## The 8 files

| Lane | Owner | File | What it contains |
| --- | --- | --- | --- |
| ci | Skeptic | `verify.yml` (unchanged) | `test` (required), `attested-receipt`, `fixed-comparison` |
| comment-router | Companion | `owner-comment-router.yml` | hosted objective / cloud feedback (was `cloud-objective.yml`, now inline job `cloud`), PR conversation (was `pr-brain.yml`, now inline), issue implementation, `/council`, Codex trigger audit, inline PR chat |
| council | Steward | `council-debate.yml` | debate, identity proof, principal proof (dispatch `council_task`) |
| owner-canary | Predictor | `lane-owner-canary.yml` | owner Actions canary, canary matrix, Mahoraga connection1026 (dispatch `canary_task`; inputs `actions_mode`, `matrix_mode`, `connection_mode`) |
| lab-evidence | Generator | `lane-lab-evidence.yml` | HF held-out CPU, HF free-CPU tournament, C06 owner model release, held-out acceptance (dispatch `lab_task`) |
| ops-audit | Sentinel | `lane-ops-audit.yml` | live acceptance audit, self-scan PR, GitLab mirror, Reef probe, council self-repair, Continuum supervisor (`reconcile`, hourly :19 UTC) (dispatch `ops_task`) |
| cloud-handoff | Builder | `cloud-pr.yml` (unchanged) | owner PR creation / room execution |
| governed-task | Ultron Core | `lane-governed-task.yml` | council worker only (was `council-worker.yml`): a dedicated single-job file, never a reusable workflow |

Retired with owner sign-off: `c06-reconcile-publish.yml` and
`governed-execution.yml` (no recorded runs), and `hf-oidc-bridge.yml` (never
succeeded: first 403 `oidc-not-authenticated`, then Hatchable's
unauthenticated GitHub readback returned 503; making it work needs an
authenticated readback credential). The signed `workflow_run` webhook path
(`hf-github-receipts`) carries the same lab receipts. The four phase-1 shadow
lane files are removed.

## How jobs were moved

- Each legacy job is copied byte-for-byte and wrapped:
  `if: >- (GATE) && ( original if )`. GATE restores the legacy file's own
  trigger set (event name, `workflow_run` workflow name, `branches: [main]`,
  the exact cron string, and the dispatch selector), so a merged trigger list
  never runs a job on an event its legacy file did not subscribe to.
- Legacy workflow-level `permissions` move onto the job when the job had none;
  lane files default to `contents: read`.
- Legacy workflow-level `concurrency` moves onto the job with the job id
  appended to the group, so lane jobs never cancel each other.
- Colliding dispatch inputs are namespaced (owner-canary `mode`). Script env
  names are unchanged.
- Callers updated: `src/pr-brain.mjs` dispatches `lane-ops-audit.yml` with
  `ops_task=self-scan-pr`; owner UI self-scan and cloud links;
  `src/self-observer.mjs`; `src/route-reference-audit.mjs`;
  `src/owner-workbench.mjs` dispatch allowlist; `src/c06-replay-admission.mjs`
  pins `lane-lab-evidence.yml`. Owner dispatch names: see
  [WORKFLOW-CHEAT-SHEET.md](WORKFLOW-CHEAT-SHEET.md).
- No widened permission ceilings. The router's reusable calls are only
  `cloud-pr.yml` (issue implementation) and `council-debate.yml` (`/council`),
  with the same ceilings as before the consolidation. The hosted objective job
  is inline in the router, and the Continuum supervisor (the only job needing
  `actions: write`) lives in ops-audit, not in `council-debate.yml`.

## Worker identity (Skeptic M1)

Hatchable trusts `lane-governed-task.yml@refs/heads/main` as the council
worker. GitHub OIDC tokens carry no job claim, so that file holds exactly one
job (`work`), has no `workflow_call`, and nothing calls it. The 8-file target
is kept by moving the former `cloud-objective.yml` job into the router instead
of adding a ninth file. `test/workflow-consolidation.test.mjs` enforces the
single-job, non-reusable shape and an explicit per-file allowlist of jobs that
may request `id-token: write` (`OIDC_JOBS` in the manifest).

## Load-bearing identities and Hatchable trust

- `verify.yml`: Sigstore signer ref, Hatchable `mahoraga-actions.js`, #351
  classifier, `workflow_run` by name, required check `test`. Unchanged.
- `owner-comment-router.yml`, `council-debate.yml`, `cloud-pr.yml`: Hatchable
  OIDC pins in `council-oidc.js`. Paths unchanged.
- Worker OIDC: `lane-governed-task.yml@refs/heads/main` (added by the
  Hatchable dual-trust release, which still accepts `council-worker.yml`).
- Lab receipts and held-out evaluator: `lane-lab-evidence.yml` with run name
  `Ultron lab evidence: <task>` (dual-trust release, see
  `docs/verification/HATCHABLE-LANE-DUAL-TRUST-2026-11-11.md`).
- `c06-live-evidence.js` pins one historical run; its recorded path never changes.

Order: Hatchable dual-trust PR merged and **deployed** -> this cutover PR ->
prove a lane receipt verifies on Hatchable -> remove old Hatchable paths.

Rollback: revert this PR. The legacy files come back unchanged and Hatchable
still trusts their paths until the final step.

## Known follow-ups

- The phase-1 lane bug fixes (pr-conversation preflight skip on unadmitted PRs,
  neutral Codex audit) are not applied yet; `src/workflow-lane-rules.mjs` keeps
  the rules and tests for that follow-up.
- If #397 adds `council-required-status.yml`, that is a ninth, separately
  reviewed file (allowed by the parity check).

## Historical shadow replay

`scripts/workflow-shadow.mjs` can still replay a legacy workflow's recorded
runs through the lane rules (read-only):
`node scripts/workflow-shadow.mjs --lane comment-router --days 14 --gh`
