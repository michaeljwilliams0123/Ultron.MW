# GitHub + Hatchable unified Ultron.MW control surface

## Current implementation and accepted target

GitHub Pages at `https://michaeljwilliams0123.github.io/Ultron.MW/` is the current owner-facing Ultron UI. GitHub `main` is the canonical source and change-review authority. Hatchable production `proj_A6GCXRSKizko` is the sole active durable backend. No new hosting provider or paid workload is introduced.

The accepted [Repository Operator decision](ULTRON-REPOSITORY-OPERATOR.md)
supersedes Pages-only UI as the target: Hatchable becomes the sole owner-facing
operational interface, while GitHub remains the development and protected
release backend. Until live parity, security, owner acceptance and rollback are
proven, Pages remains the current transitional interface and is not deleted.

GitHub Pages **cannot execute server functions, securely hold an admin token, or replace managed PostgreSQL / the Hatchable scheduler**. It is deliberately a static user interface, not a privileged proxy.

## Deep module seam (CodebaseDesign)

The public cloud-status interface is deliberately narrow:
- `GET /api/brain/status-public`, anonymous, no request body, no side effects.
- Schema `ultron.cloud-status.v1` with `ok`, `status` (`active` or `paused`), `observedAt`, `lastEventAt`, `scheduler` (`hourly-configured`), and `ownerOperations` (`protected`).
- The Hatchable adapter reads **only** pause state and timestamp of latest ledger event. It never returns objectives, notes, payloads, task IDs, event IDs, identities or tokens. Data is operational and publicly readable; CORS is not an authorization boundary.
- The Pages adapter `docs/core/cloud-status.mjs` accepts an injectable fetcher, validates the schema and discards any unknown fields. It invokes GET with `credentials: 'omit'`, without tokens or user secrets.
- One view in Systems; one request when opened, with explicit manual refresh. No background polling, free-tier churn, separate sign-in, iframe or Descope.

The public status is **not** proof of active scheduler firing, AI thinking, backend write acceptance, or completed objectives. `hourly-configured` is a declared configuration. Admin task execution remains under existing Hatchable `access='admin'`; scheduler routes remain private. Future privileged actions must use a genuinely owner-authenticated server-mediated operation with anti-CSRF and independent postcondition readback. Do not place Hatchable personal access cookies, PATs, or signing keys in Pages JavaScript.

## Source authority, deploy and acceptance

GitHub tracks Hatchable deployable files under `cloud/hatchable/`. The production landing is synchronized to the Descope-free v19 version. The new `api/brain/status-public.js` file must be deployed to production by Hatchable after the PR passes independent CI checks, then compared for byte parity against the merged GitHub file. Ordinary GitHub Pages deployment does **not** deploy Hatchable functions.

Acceptance:
1. Verify on the exact PR SHA, including client module contract tests.
2. Hatchable dry-run, deploy, live anonymous GET 200 with correct restrictive payload and CORS for the canonical Pages origin.
3. Denied unauthenticated admin GET and scheduler invocation still return 401/404 respectively.
4. GitHub Pages Systems tab renders live status and handles offline failure without asserting success.
5. No copy of credentials or backend private data enters the GitHub public repository.

This is an incremental integration, **not** a migration of all Hatchable functionality into the static GitHub host. Preserve the existing recovery / uncertain-write checks and one active scheduler.
