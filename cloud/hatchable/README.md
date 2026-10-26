# Ultron.MW — Hatchable cloud brain (v2 design, deployment v3)

Source snapshot of the **deployed private owner-only** `ultron-mw-cloud` Hatchable backend. This is a source-review PR, not a GitHub Pages/UI replacement.

**Current release evidence (October 24, 2026):** Hatchable deployment v3 is
live and all 15 runtime files match PR source commit
`9fd3e3e9c2b8321c385b6775d15ad439888e8a68` by SHA-256 and size.
GitHub Verify passed for that commit. The owner-only admission, duplicate-key
suppression, public/member denial, scheduler-only edge denial, completed
read-only task with matching receipts, and expired-lease recovery were checked
against v3. The source-only holds described below are historical checkpoints.
Post-commit database response loss remains covered by the local mock-driver
test, not a live fault injection. No GitHub write authority, OpenAI key, or
independent Destiny account proof is implied by this deployment.

- Management: https://hatchable.com/console/projects/ultron-mw-cloud
- GitHub Pages remains the sole primary interface: https://michaeljwilliams0123.github.io/Ultron.MW/
- Live isolated backend: https://ultron-mw-cloud.hatchable.site (personal/private)
- Native MCP endpoint: https://ultron-mw-cloud.hatchable.site/mcp (requires independent OAuth client authorization)

## Cloud landing and Descope identity UI (October 24)

`public/index.html` now serves a real root page instead of a static 404. It links
back to GitHub Pages as Ultron's canonical interface and to Hatchable Setup.
An embedded, pinned Descope web component uses the **existing** project's
`sign-in` flow for optional identity authentication. The connected Descope
project ID is public client metadata, never a management credential.

**Authority boundary:** This browser-only sign-in does not authorize any
Hatchable backend route, replace Hatchable's personal-project access control,
or configure missing Mahoraga GitHub App credentials. The admin and scheduler
API routes remain server-side restricted. A future API route can accept Descope
tokens only after proper server-side session signature, audience, expiry,
and owner identity validation has been independently tested. The existing flow
must also be checked for allowed domains and owner-only enrollment in Descope.

## Implemented tools

Five bounded native objectives: `repo.inspect`, `repo.prs`, `repo.ci`, `site.render` (managed browser), and `council.review` (deterministic advisory; **not an LLM**). They run in a persistent Postgres queue with leasing, retry/backoff, hourly recovery and auditable event receipts.

`council.review` now has a source-level versioned evidence contract. Each available verifier, sentinel, planner and skeptic assessment names the council objective, exact observed GitHub source SHA, durable task/event receipt IDs, evidence time/freshness, dissent and known unknowns. GitHub observations read `main` before and after collection; drift invalidates the observation. CI evidence must be a complete exact-head inventory whose newest `Ultron core verification` push and required `test` job both completed successfully. PR inventories must not be truncated, and a rendered site must publish the same runtime source SHA rather than merely contain an app shell. The profiles are labeled `deterministic-role-profile`; four profiles from one algorithm never count as four independent reviewers. Assessment events are inserted into the existing `brain_events` ledger in the same lease-fenced PostgreSQL statement that completes the council task. A duplicate, malformed, stale, contradictory or source-mismatched receipt cannot become promotion evidence.

The associated gate can mark evidence only `eligible-for-protected-pr`, never executable. The council anchors the complete decision to live `main` readbacks before and after evaluation and queries reviewer and evaluation events by the exact objective and source SHA. It requires a genuinely independent reviewer whose referenced `independent-reviewer-attested` event is separately read from the SQL ledger and matches an exact allowlisted readback adapter, an active matching lease, any required provider/token readiness, and an objective-bound frozen disjoint before/after evaluation. The evaluation's event identity and time come from its ledger row. A separately persisted frozen-set manifest must predate every declared baseline/candidate task pair; each task must map one-to-one to a durable `observed` event whose joined task objective and result match the same objective, source, set, case and variant. Scores and failure counts are recomputed from those readbacks and must equal the evaluation record. Positive held-out gain, zero observed candidate failures/critical regressions, and matching postmerge runtime source remain required. External-action states and readbacks use a closed schema; duplicate IDs, unknown states and impossible combinations hold. An uncertain external write is read back and never replayed automatically. See [the issue #68 verification contract](../../docs/verification/ISSUE68-COUNCIL-EVIDENCE-2026-10-24.md).

The source includes a fail-closed GitHub adapter for independent-reviewer evidence and an advisory review-count proxy; it does not provide an independent held-out evaluation. Before review begins, an owner-authenticated PR comment must freeze the baseline PR, candidate PR/head, evaluator, and scoring rule. After the reviewed PR is the current merged `main`, the adapter requires an independently authored CodeRabbit review on that exact head, verifies current-main/reviewed-head tree equality, recomputes before/after actionable-finding scores, and commits the task/event projection in one idempotent SQL statement. Every later council run rereads GitHub and reproduces those claims before setting the reviewer trusted-adapter signal only; the evaluation signal remains false, and the protected held-out gate stays held. Hand-authored SQL labels remain insufficient. Deployment and a successful owner invocation are still required before the live gate can use this source.

Owner-only API: `GET/POST /api/brain/tasks`, `POST /api/brain/command`. Scheduler-only: `/api/brain/tick` (hourly) and `/api/brain/run` (asynchronous). Commands: `/help`, `/status`, `/repo inspect`, `/repo prs`, `/repo ci`, `/site render`, `/council review`, `/remember <note>`. Actions: queue, note, cancel, retry, and `acceptance` with an objective ID and merged candidate pull-request number.

MCP tools: `ultron_status`, `ultron_queue`, `ultron_remember`, `ultron_control`. These are **owner/admin-gated** and require an independent OAuth authorization before use by a connected AI client.

## Evidence and constraints

Production version 2 deployed October 22, 2026. Verified from the owner runtime: five objectives completed, native GitHub PR and workflow readback, Chromium-rendered GitHub Pages, deterministic council receipts, immediate owner task dispatch, cancel/retry and idempotency collision checks, rejection of unsupported commands, and public/member access denial.

No provider LLM inference/credits, GitHub writes, PR merges, execution of arbitrary code, desktop remote control, or authenticated browser sessions are enabled here. The GitHub API accesses only public repo metadata. The backend deliberately performs no actions against private Mahoraga source.

**Deployment is not automatic:** Hatchable is currently deployed from its project console through its connector. Files under `cloud/hatchable/` are mirrored source for review and recovery. A subsequent change must update both and verify that exact deployed version; do not assume merging this PR deploys the backend. GitHub main SHA and platform version must be reconciled before claiming source–production parity.

Never place API keys or private notes in this public repository.

## Mahoraga control lane (issue #95)

The `ultron_mahoraga` owner-only MCP tool and `/api/brain/mahoraga` admin API
accept two bounded writes: create an issue at an expected Mahoraga `main` SHA,
or dispatch the existing Verify workflow on a `mahoraga/*` branch at an expected
head SHA. Admission creates one `brain_tasks` identity in `external` state and
one linked `mahoraga_actions` record with a matching event receipt. The cloud
action key is unique; the intent is
persisted before an external call and the state changes to `sent` before a POST.
After that transition, repeat calls perform GitHub readback and never repeat
the POST. A missing or ambiguous readback remains `uncertain`. The ordinary
`brain_tasks` retry loop never executes external writes. A separate bounded
hourly recovery scans only previously admitted `mahoraga_actions` and queues the
existing scheduler worker. At most two actions are visited per hourly run:
`prepared` actions may make their first write after independent App credentials
are configured and the original exact-SHA preflight passes; `sent` or `uncertain`
actions are readback-only. Missing credentials remain `prepared` with no write.
Neither ordinary owner-requested runs nor read-only backlog continuations can
activate the external recovery path. Recovery never creates new Mahoraga goals.

The project manifest declares three **optional, protected** values: the
Mahoraga-scoped GitHub App client ID, installation ID, and private key. They
must be supplied in Hatchable Setup; no value belongs in Git or API requests.
The app must be installed on only the private Mahoraga repository with
`contents:read`, `issues:write`, and `actions:write`. Missing values leave the
write lane unavailable while the read-only cloud brain continues to run.
GitHub App identity is separate from the owner's human account and Destiny.

The issue marker lets an uncertain issue creation reconcile exactly. GitHub's
Verify dispatch API returns no run ID; readback accepts only one workflow run
on the exact branch and SHA after the recorded attempt time. Concurrent matching
runs remain uncertain rather than claiming a unique result. Do not manually
reset a `sent` or `uncertain` action to `prepared`. Revoke the app installation
to stop future calls. A source merge alone does not supply credentials, deploy
this code, or prove a live Mahoraga write.


## October 22 source hardening (PR #76; deployed in v3 on October 24)

This PR now includes a lease-fenced, atomic task/event transition repair. Claim, completion, failure, expired-lease recovery, owner admission, cancellation/retry, note creation and hourly task admission write the matching audit receipt inside the **same PostgreSQL statement**. A worker that loses its lease returns `lost-lease` rather than inventing a `failed` receipt. The hourly handler only enqueues the read-only inspection task and schedules the separate bounded /api/brain/run worker when ready backlog exists; it does not execute slow site renders inside the short cron fire budget. This is not unlimited polling.

Evidence: GitHub core Verify on historical commit `fcef009b6bbd3d8ff653aa3ebad51fe483b496ea` passed for that commit only; any newer PR head requires a separate exact-head Verify before merge. Mock-driver regression checks cover success/lost lease/idempotent admission/owner controls. Three representative atomic statements passed PostgreSQL non-executing `EXPLAIN` against live v2 schema. No crash fault-injection against the live runtime, user-session acceptance, or source-to-deployment parity is implied.

**Do not deploy only these mirror files and assume the backend changed.** Review the complete PR, mirror the changed files through Hatchable's deployment path, validate with the platform dry-run, deploy deliberately, and then prove live task and event correlation, recovery, bounded backlog, owner authentication and rollback. Production is still version 2 until independently checked otherwise.

For the model-powered next stage, see [OPENAI-AGENTS-INTEGRATION.md](./OPENAI-AGENTS-INTEGRATION.md). OpenAI inference and hosted sandboxes remain **off**; no billable requests were initiated.

## Read-only source/deployment parity check (not a deployment)

To compare the source checked out at an exact PR head with a known live Hatchable deployment:

1. In the **existing private Hatchable project**, retrieve `get_deployment(version)` for the **current** deployment and save its JSON response object (the fields `version`, `status`, and `file_manifest`) outside the repository, e.g. `/tmp/hatchable-deployment.json`. Do not save session data or credentials to GitHub.
2. Check out the exact PR commit and run:

   ```sh
   node scripts/verify-hatchable-parity.mjs --manifest /tmp/hatchable-deployment.json --version 2 --head "$(git rev-parse HEAD)"
   ```

   In reviews/automation, replace the `--head` substitution with the exact expected **current PR head SHA** retrieved independently from GitHub, to detect an outdated checkout. Do not derive the expected SHA from the same checkout being checked.
3. Inspect `parity`, `filesCompared`, and `differences`. Nonzero exit means mismatch or invalid evidence. The script compares SHA-256 *bytes and sizes* from immutable Git blobs at the declared exact head for every runtime file under `api/`, `lib/`, `mcp/`, `migrations/` and `hatchable.toml`. This avoids false mismatches from Windows line-ending conversion and prevents uncommitted working-tree bytes from being mistaken for reviewed source. It reports missing/extra/changed files, stale Git head, invalid manifests and stale/non-live versions. README and proposals are not deployed runtime files and are excluded.
4. Immediately re-read Hatchable's **current** deployment version and the GitHub PR head after the comparison. An unchanged version and head are prerequisites for interpreting this snapshot as current. This local verifier does **not** query Hatchable on its own or prove production traffic, owner authentication, receipt integrity, crash recovery, or end-to-end acceptance.

Tests: `node --test test/hatchable-parity.test.mjs` (also included in `node scripts/verify.mjs`). Run against the existing private project only; do not deploy draft source to force matching hashes. A mismatch is an expected **PRODUCTION_HOLD** until a separately approved source-merge and deliberate deployment/rollback sequence has been verified.

## Historical V2 release-acceptance matrix — source-only gate (PR #76)

**WorkId:** pr76-v2-release-acceptance-matrix-699abf0f. This checklist is a
release **gate**, not deployment approval or evidence production was updated.
At the Stage 2 handoff (October 23, 2026), Hatchable project
proj_A6GCXRSKizko reported **live version 2**, with 15 runtime files.
The last independently compared PR source snapshot found **four differences**;
do not promote that historical result to a fresh production readback.
The current source adds `lib/council-evidence.js`; it is intentionally absent
from this historical 15-file live-v2 snapshot and therefore increases the
source/deployment parity hold until a separately authorized deployment proves it.

| Runtime source group | Files | Stage 2 source vs. live v2 |
| --- | --- | --- |
| API | api/brain/command.js, api/brain/tasks.js | 2 matched |
| API scheduler | api/brain/run.js, api/brain/tick.js | **2 differed** |
| Libraries | lib/brain-core.js | 1 matched |
| Libraries / state | lib/brain-owner.js, lib/brain-runner.js | **2 differed** |
| MCP | mcp/ultron_control.js, mcp/ultron_queue.js, mcp/ultron_remember.js, mcp/ultron_status.js | 4 matched |
| Migrations | migrations/0001_tasks.sql, migrations/0002_events.sql, migrations/0003_native_commands.sql | 3 matched |
| Configuration | hatchable.toml | 1 matched |
| **Total** | **15 files** | **11 matched, 4 differed — PRODUCTION_HOLD** |

The four divergent paths require independent functional acceptance, not just
matching bytes:

| Runtime path | Required acceptance evidence |
| --- | --- |
| api/brain/run.js | Authenticated scheduler dispatch, bounded processing/continuation, duplicate suppression, and task/event readback |
| api/brain/tick.js | Hourly tick remains dispatch-only, does not run browser objectives inline, and dispatches expired-lease recovery within the scheduler budget |
| lib/brain-owner.js | Owner-only admission, idempotency conflict, cancel/retry eligibility and atomic matching event receipts |
| lib/brain-runner.js | Lease-fenced claim/complete/fail, atomic result/event, recovery after expired lease, and completion-write uncertainty without false failure or unsafe immediate replay |

**Before any separately authorized deployment:** Re-read the exact GitHub PR
head, required PR-head CI jobs, Hatchable project identity, current live
deployment version/status and complete file manifest. Obtain an independent
versioned manifest readback; use the immutable-Git-blob verifier above against
that version and the exact current PR SHA. A stale head, missing/extra file,
invalid/unsafe/duplicate manifest entry, non-live deployment or changed hash
must fail closed. Preserve the previous live version and a documented rollback
target. Never include credentials, private notes or tokens in the manifest.

**After an explicitly authorized deployment:** Independently re-read the
current deployed version and its 15-file manifest, verify all hashes/sizes
against the reviewed Git SHA, then repeat the project/version/head readback to
exclude races. Separately validate owner authentication, scheduler budget,
durable receipt correlation, failed event-insert rollback, expired-lease
recovery, completion-persistence uncertainty, and a bounded read-only replay
scenario using isolated test data. A green GitHub unit test or synthetic
manifest is **not** proof of live database or end-user behavior.

**Release decision:** Keep **PRODUCTION_HOLD** and PR draft until the
independent live evidence, rollback readiness, required CI and owner release
authorization all pass. On any failure, stop promotion; if a deployment was
performed, revert to the independently recorded prior live version and verify
its status/readback. For this Stage 3 source-only change, rollback is a revert
of its one PR-branch commit; do not alter the Hatchable deployment.


### October 23 read-failure and recovery evidence (source-only)

WorkId: `pr76-v2-release-acceptance-matrix-699abf0f`. The existing live
Hatchable v2 tick returned HTTP 503 at 07:40:09 UTC; the observed
`repo.inspect` task 37 failed a GitHub metadata read with
`github-status-403`, recorded a failed receipt, and was queued at attempt
1/3 with a 15-minute retry interval. The upstream 403 cause is **unknown**;
a scheduler HTTP 503 does not independently establish that cause.

**One-task production recovery confirmed (read-only, October 23, 2026):**
Hatchable project `proj_A6GCXRSKizko` still reports **live v2**. A fresh
SELECT of `brain_tasks` independently found the same task **37**
(`repo.inspect`) at `done`, attempts **2/3**, with `lease_until=NULL`
and `updated_at=2026-10-23T08:40:09.433068Z`. Its event ledger contains
`#64 claimed` (attempt 1, 07:40:09 UTC), `#65 failed`
(`github-status-403`), `#66 claimed` (attempt 2, 08:40:09 UTC), and
`#67 observed` (`source=github-api`, 08:40:09 UTC). The independently
reported hourly tick returned **200** at 08:40:09 UTC after **503** at
07:40:09 UTC. This is evidence that **one read-only retry completed and
persisted an observation**, not proof that the original GitHub 403 was
diagnosed, that every scheduler fire succeeds, or that injected database
failures and crash recovery are safe. No production task was created or
modified to obtain this readback.

The PR's isolated regression driver now exercises the actual GitHub-read
objective through the runner with a synthetic 403, asserts **no observed
receipt**, verifies a lease-fenced failure receipt and that an early retry
cannot reclaim work, then accepts a valid SHA read after the configured
15-minute interval. An expired-lease variant refuses a stale worker's
failure receipt. These tests model database transitions and network replies;
they are **not** live PostgreSQL fault injection or production recovery
proof. No credentials, API billing, or production changes are involved.

**At the October 23 source-only checkpoint, PRODUCTION_HOLD remained:** obtain independently authenticated GitHub
403 diagnostics and live task/event correlation, prove bounded recovery
under the deployed scheduler, and reconcile all 15 deployed runtime hashes
(especially the four divergent files) before any separately approved
deployment/merge or rollback decision.

### October 24 scheduler recovery correction (source only)

The hourly tick now dispatches the worker when an expired lease needs recovery,
even if no task is currently queued. After a full four-task batch, the worker
checks for ready work and schedules at most one additional bounded batch; that
second batch cannot schedule another continuation. Focused tests exercise both
paths, including the absence of inline work in the hourly tick. These source
changes are not evidence that production v2 has been updated or that live
PostgreSQL recovery has passed.
