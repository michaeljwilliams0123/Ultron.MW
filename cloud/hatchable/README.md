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
