# Hatchable dual trust for the 26 -> 8 workflow consolidation (step 1 of 3)

Owner decision (Nov 10, 2026): "Get to the 8, redeploy cleanly." This PR is
**step 1**: Hatchable accepts BOTH the legacy workflow identities and the
consolidated lane identities. Nothing is removed. Workflows are unchanged.

| Hatchable module | Legacy identity (still trusted) | Lane identity (new) |
| --- | --- | --- |
| `lib/council-oidc.js` worker | `council-worker.yml@refs/heads/main` | `lane-governed-task.yml@refs/heads/main` (dedicated single-job worker file, no `workflow_call`; a parity test in #418 enforces this because GitHub OIDC has no job claim) |
| `lib/hf-github-receipts.js` | `hf-heldout-cpu.yml`, `hf-free-cpu-tournament.yml`, `c06-owner-model-release.yml` (path) | `lane-lab-evidence.yml` + workflow name `Ultron lab evidence` + run title `Ultron lab evidence: <task>` |
| `lib/hf-lab-view.js` | per-file latest run | newest of legacy run and exact-identity lane run |
| `lib/heldout-evidence.js` | `held-out-acceptance.yml` + `Ultron held-out acceptance` | `lane-lab-evidence.yml` + `Ultron lab evidence`; frozen `workflowBlobSha` must be that same file's blob |

Unchanged on purpose (their files stay the lane file): `verify.yml` (required
check `test`, Sigstore receipt signer ref, `mahoraga-actions.js`),
`owner-comment-router.yml`, `council-debate.yml`, `cloud-pr.yml` (room
execution `job_workflow_ref`). `c06-live-evidence.js` pins one historical run
whose recorded path never changes. `github-oidc-bridge.js` (`hf-oidc-bridge.yml`)
is retired in step 3 together with its workflow (step 2): its only real
attempts were rejected at Hatchable's unauthenticated GitHub readback (HTTP 503
`github-readback-unavailable`), and the signed `workflow_run` webhook path
already covers the same receipts.

A lane run is never identified by path alone: one lane file runs several legacy
jobs, so the receipt key comes from the exact (path, workflow name, run title)
triple. The run title comes from the lane's `run-name` and a `choice` input.
Any repository writer can dispatch the lane; the jobs themselves are
owner-only, so a non-owner dispatch produces a skipped run. Receipts are
admitted only for the owner actor (the bot actor is no longer trusted for lab
receipts), and reconciliation verifies that the run's commit is on `main`
through `GET /compare/{sha}...main` before a receipt becomes `verified`. A
`head_branch` of `main` alone is not trusted (it can also be a tag named
`main`). The lab view shows a lane run only if it is an owner
`workflow_dispatch` on `main`.

## Live-only files now in source

`public/local-workbooks.html`, `public/local-workbooks.js` and
`public/vendor/fflate-0.8.2.min.js` were served by production v87 but missing
from main. They were pulled from the live site; platform-injected markup
(`__HATCHABLE__` config, badge, `?v=` cache busters) was stripped and the stale
`github.com/Ultron-MW/Ultron.MW` link fixed. The vendor file is byte-identical to
npm `fflate@0.8.2` `umd/index.js` (sha256 `c3b34f2e…5ddf`).

**Still live-only:** production also serves `GET /api/brain/local-workbooks`
(HTTP 401, owner route). Its source (and any lib it imports) is not public and
is not in this repository. Pull it from Hatchable (`get_deployment` file
manifest) before any full redeploy, or the route disappears.

## Sequence

1. Merge this PR. Deploy it to Hatchable (changed files only, see below).
2. Merge step 2 (lane workflows live, legacy files retired). Run each lab task
   and one worker dispatch from the lane files; prove Hatchable admits the
   lane receipts (`hf_github_receipts.state='verified'` for a lane run; worker
   OIDC accepted).
3. Merge step 3 (remove legacy pins + OIDC bridge) and deploy.

## Deploy and rollback (Hatchable connector or console)

Before: `get_deployment(<current>)` and save `{version,status,file_manifest}`
outside the repo (rollback record; v87 at last observation). Run
`node scripts/verify-hatchable-parity.mjs --manifest <file> --version <v> --head <main sha>`
to list every live/main difference.

Deploy: from merged `main` only. Upload the changed runtime files (this PR:
`lib/workflow-lanes.js`, `lib/council-oidc.js`, `lib/hf-github-receipts.js`,
`lib/hf-lab-view.js`, `lib/heldout-evidence.js`, the three public files).
**Do not upload `migrations/0029`–`0043`** in the same deploy: production's
ledger was last confirmed at `0028`, and `0029`, `0031`, `0032`, `0034`, `0040`
and `0041` replace constraints, rewrite rows or relax `NOT NULL`. `dry_run_deploy`
must show zero blocking errors. Then read back the new version and manifest.

Verify: `/` (Cloud controls) and `/council-room.html` load; `/local-workbooks.html`
200; `/api/brain/status-public` 200; anonymous `/api/brain/tasks` 401; parity
script against the new manifest reports only the expected differences.

Rollback: forward-deploy the saved previous manifest's file bytes (the v18
rollback drill procedure). No database change is involved in this step.
