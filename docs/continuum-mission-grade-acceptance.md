# Ultron Continuum — mission-grade acceptance (12 stages)

## Purpose and evidence boundary

Expand the light single-note canary to a **multi-track release mission**. This is
an executable regression contract for #241 (child of #204/#188), not a
declaration that Ultron has completed autonomous source-to-production delivery.

The Node fixture invokes the real `createDeepTaskPlan` and `runDeepTask`
functions with in-memory ledger/bridge adapters. It is **source-only / simulated**
evidence. The separate Hatchable/Mahoraga canary below is a **real observed
external issue write**, not an executed two-PR release or Destiny/Codex handoff.

## Mission DAG

| Order | Step | Capability | Dependency |
| --- | --- | --- | --- |
| 1 | branch-alpha | branch.create | start |
| 2 | patch-alpha | source.patch | branch-alpha |
| 3 | pr-alpha | pr.create | patch-alpha |
| 4 | ci-alpha | ci.verify | pr-alpha |
| 5 | branch-beta | branch.create | pr-alpha |
| 6 | patch-beta | source.patch | branch-beta |
| 7 | pr-beta | pr.create | patch-beta |
| 8 | ci-beta | ci.verify | pr-beta |
| 9 | merge-alpha | pr.squash | ci-alpha, ci-beta |
| 10 | merge-beta | pr.squash | ci-beta, merge-alpha |
| 11 | deploy-both | deploy.reversible | merge-alpha, merge-beta |
| 12 | runtime-prod | runtime.verify | deploy-both |

There are **nine potentially mutating stages**, plus three read-only verification
stages. Each mutating step must have a durable reservation, a single dispatch
and a matching independent readback before a successor becomes eligible.
Release also requires the current exact-head CI and GitHub mergeability;
deployment requires a verified rollback coordinate.

## Reproducible regression suite

Run:

```sh
node --test test/deep-task.test.mjs
node scripts/verify.mjs
```

The canonical GitHub workflow additionally executes PostgreSQL acceptance
tests on an ephemeral database and checks the exact pull-request head.

| Case | Scenario | Passing assertion |
| --- | --- | --- |
| MISSION-01 | Twelve-step DAG, 4 steps per invocation, process restart/replay | All 12 steps complete in three cycles, exactly nine external writes, 12 receipts, and a fourth replay dispatches zero |
| MISSION-02 | External observation disappears *after* second merge dispatch | Hold at merge-beta; reconciliation resumes without another merge; deployment cannot precede it |
| MISSION-03 | Owner pause between tracks | No new writes while paused; authorized resumption does not replay earlier writes |
| MISSION-04 | CI or mergeability invalid before release | Both merges held; restoring verifiable eligibility resumes |
| MISSION-05 | Previously verified receipt digest changes | Return held with receipt conflict; no dependent release write |
| MISSION-06 | Lost provider response at **each** of the nine write boundaries | All nine variants converge without a second write |
| MISSION-07 | Missing postcondition at **each** of the nine write boundaries | All nine variants hold successors, then reconcile without replay |

The `maxSteps` safeguard means **newly advanced stages in one invocation**;
already verified history is re-observed but must not consume the fresh step
budget. Previously, a 12-stage plan stalled permanently after eight confirmed
steps; #242 corrects this without lifting the eight-step execution limit.

## Observed live cross-system proof (2026-11-03 ET)

- Hatchable deployed source: v33, owner profile v5, stop version 3, paid ceiling $0.
- Owner-scoped `POST /api/brain/deep` created immutable task key
  `mission:c06:crossrepo:nov03-pr242-01`.
- GitHub independently exposed
  [Mahoraga #1190](https://github.com/michaeljwilliams0123/mahoraga/issues/1190),
  containing the matching action marker and a detailed two-track acceptance
  specification. This was an actual private-repository issue write.
- The initial Hatchable response was HTTP 202 `reconcile-required`, with
  provider action recorded `uncertain`; GitHub already showed the issue existed.
- The **same-key reconciliation-only** call returned HTTP 200 `completed`,
  external issue **1190**, without another external POST. This distinguishes
  a successful provider write from a temporarily missing origin-side ACK.
- An issue record or a passing simulated DAG cannot establish that a source
  PR was created, CI/review passed, a squash merge occurred, or deployed code
  passed an independent production canary.

## Production promotion gates still open

Keep #185, #188, #194, #195 and #204 open unless separately proven:

1. Real two-source-PR creation and independently verified protected merges.
2. Actual Destiny/Codex executor claim, signed completion and route receipts.
3. Independent external readbacks for every resource and post-release rollback.
4. A measured 24-hour autonomous pilot and seven-day scheduled-run SLO.
5. Provider/credential scope, stop/revoke, replay under concurrency and the
   explicit $0 paid-provider ceiling in the same external execution lineage.

**Do not replace missing evidence with green CI or advisory Council output.**
