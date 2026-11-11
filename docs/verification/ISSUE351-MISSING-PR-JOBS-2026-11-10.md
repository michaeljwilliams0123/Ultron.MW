# Issue #351: missing PR workflow jobs — evidence, root cause, diagnostic

Refs #351. Read-only investigation, 2026-11-10. No workflow, required-check,
ruleset, secret, or job name was changed.

## Evidence (public GitHub API + run pages)

All failing PR #350 runs fall in one window, 2026-11-09 18:11:54–18:21:30 UTC,
and span **all three** PR workflows (Core, Reef, Council):

| Run | Workflow | Event | Jobs created | Run-level annotation |
|---|---|---|---|---|
| 42671890092 | Core | opened | `attested-receipt` (skipped) only | `Internal server error. Correlation ID: b9cb2ce6-fad4-4090-825e-b43d1094463b` |
| 42672221398 | Core | synchronize | none | `Internal server error. Correlation ID: 082e1424-2bab-416d-b9ec-8f90beb9ca7d` |
| 42672525232 | Council | synchronize | none | `Internal server error. Correlation ID: c92b633c-82b0-4222-8053-b7b4460c0150` |
| 42672525497 | Core | synchronize | `test`, `attested-receipt` | `Internal server error. Correlation ID: a969c6d7-34b3-4e22-87f6-86b3b71ce7bf` |
| 42673071112 | Core | edited | none | `Internal server error. Correlation ID: af5e236e-ceae-4d69-80ab-4efa9d77a574` |
| 42673171734 | Core | synchronize | none | `Internal server error. Correlation ID: 7f004375-73ac-4216-9da7-70bb31d2e95b` |
| 42673177149 | Core | synchronize | none | `Internal server error. Correlation ID: e1b62ece-1064-420a-b250-cb2fb3acec32` |
| 42673201398 | Core | synchronize | `test`, `attested-receipt` | `Internal server error. Correlation ID: 05a0b91b-ee00-411d-8ba9-df8959401404` |
| 42673203739 | Reef | synchronize | none | `Internal server error. Correlation ID: 6bc09c3e-aa5d-4486-9531-4acd548a0134` |

- `.github/workflows/verify.yml` and `reef-runtime-probe.yml` at heads
  `79fb154f…` and `b067855b…` are byte-identical to the merge base
  `57d5107e…`; the same files produced full green runs before and after
  (e.g. #352 Core 42679882620, #350 Core 42680204523 at 19:06 UTC).
- The missing jobs are always **root jobs** (no `needs:`): `test`,
  `fixed-comparison`, `reef-runtime-probe`, `council-debate`. Jobs created later
  via `needs:` (`attested-receipt`) were created normally.
- GitHub Status incident "Incident with Actions and Checks API"
  (https://stspg.io/7yw63xl9ztrv, id `tp8cghg7tlc4`, impact critical):
  investigating 18:12:37 UTC ("degraded availability for Actions"), mitigated
  18:43 UTC, resolved 18:59:32 UTC on 2026-11-09.

## Root cause

GitHub Actions service-side job-creation failure during the 2026-11-09 Actions
and Checks API incident. GitHub failed to create some root jobs (logged only as
a run-level `Internal server error` annotation), then concluded the run
`failure` even though every job that *was* created succeeded. This is not a
workflow configuration, reusable-workflow, or source defect; no workflow change
is warranted and none was made.

## Repository-side mitigation

- `src/ci-job-presence.mjs` classifies a Core run from the jobs actually created:
  a missing or skipped expected job is `unknown-missing` (never green, never a
  test failure), with recovery `rerun-entire-workflow-on-same-head`
  (rerun-failed-jobs returned 403 on zero-job runs).
- `scripts/ci-job-presence.mjs <runId>` is a read-only diagnostic (exit 0 only
  for `green`).
- `test/ci-job-presence.test.mjs` pins verify.yml's job graph, `if:` conditions,
  exact-head checkouts, trust gate, and attestation permissions, so a config
  change that would silently drop or skip `fixed-comparison` fails `verify.mjs`.

Remaining #351 acceptance (owner): one fresh exact-head PR run with `test`,
`fixed-comparison`, `attested-receipt`, Reef and Council terminal green under
normal branch protection, and the unblock receipt in #204 / PR #350.
