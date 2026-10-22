# Ultron.MW — Hatchable cloud brain (v2 source snapshot)

Source snapshot of the **deployed private owner-only** `ultron-mw-cloud` Hatchable backend. This is a source-review PR, not a GitHub Pages/UI replacement.

- Management: https://hatchable.com/console/projects/ultron-mw-cloud
- GitHub Pages remains the sole primary interface: https://michaeljwilliams0123.github.io/Ultron.MW/
- Live isolated backend: https://ultron-mw-cloud.hatchable.site (personal/private)
- Native MCP endpoint: https://ultron-mw-cloud.hatchable.site/mcp (requires independent OAuth client authorization)

## Implemented tools

Five bounded native objectives: `repo.inspect`, `repo.prs`, `repo.ci`, `site.render` (managed browser), and `council.review` (deterministic advisory; **not an LLM**). They run in a persistent Postgres queue with leasing, retry/backoff, hourly recovery and auditable event receipts.

Owner-only API: `GET/POST /api/brain/tasks`, `POST /api/brain/command`. Scheduler-only: `/api/brain/tick` (hourly) and `/api/brain/run` (asynchronous). Commands: `/help`, `/status`, `/repo inspect`, `/repo prs`, `/repo ci`, `/site render`, `/council review`, `/remember <note>`. Actions: queue, note, cancel, retry.

MCP tools: `ultron_status`, `ultron_queue`, `ultron_remember`, `ultron_control`. These are **owner/admin-gated** and require an independent OAuth authorization before use by a connected AI client.

## Evidence and constraints

Production version 2 deployed October 22, 2026. Verified from the owner runtime: five objectives completed, native GitHub PR and workflow readback, Chromium-rendered GitHub Pages, deterministic council receipts, immediate owner task dispatch, cancel/retry and idempotency collision checks, rejection of unsupported commands, and public/member access denial.

No provider LLM inference/credits, GitHub writes, PR merges, execution of arbitrary code, desktop remote control, or authenticated browser sessions are enabled here. The GitHub API accesses only public repo metadata. The backend deliberately performs no actions against private Mahoraga source.

**Deployment is not automatic:** Hatchable is currently deployed from its project console through its connector. Files under `cloud/hatchable/` are mirrored source for review and recovery. A subsequent change must update both and verify that exact deployed version; do not assume merging this PR deploys the backend. GitHub main SHA and platform version must be reconciled before claiming source–production parity.

Never place API keys or private notes in this public repository.


## October 22 source hardening (PR #76, **not deployed**)

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
3. Inspect `parity`, `filesCompared`, and `differences`. Nonzero exit means mismatch or invalid evidence. The script compares SHA-256 *bytes and sizes* for every runtime file under `api/`, `lib/`, `mcp/`, `migrations/` and `hatchable.toml`, reporting missing/extra/changed files, stale Git head, invalid manifests and stale/non-live versions. README and proposals are not deployed runtime files and are excluded.
4. Immediately re-read Hatchable's **current** deployment version and the GitHub PR head after the comparison. An unchanged version and head are prerequisites for interpreting this snapshot as current. This local verifier does **not** query Hatchable on its own or prove production traffic, owner authentication, receipt integrity, crash recovery, or end-to-end acceptance.

Tests: `node --test test/hatchable-parity.test.mjs` (also included in `node scripts/verify.mjs`). Run against the existing private project only; do not deploy draft source to force matching hashes. A mismatch is an expected **PRODUCTION_HOLD** until a separately approved source-merge and deliberate deployment/rollback sequence has been verified.
