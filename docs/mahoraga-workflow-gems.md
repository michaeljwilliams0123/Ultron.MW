# Mahoraga Workflow Gems & Ecosystem Knowledge Share

This document records the workflow patterns, reliability safeguards, and architectural lessons audited from `michaeljwilliams0123/mahoraga` and ported into `michaeljwilliams0123/Ultron.MW` (PR #579).

## 1. Gems Ported into `Ultron.MW`

1. **Zero-Credit Contract Validation (`.github/workflows/contract-validation.yml`)**
   - *Origin:* `mahoraga/contract-validation.yml`.
   - *Purpose:* Runs fast, secret-free, zero-credit static checks (`check-workflow-references.mjs`, `check-cloudflare-parity.mjs`, `audit-secret-isolation.mjs`) on every PR and `main` push without booting Postgres or installing `npm` dependencies.
2. **Stale Jobless Queued-Run Reaper (`.github/workflows/lane-ops-audit.yml`)**
   - *Origin:* `mahoraga` commit `bd6a470`.
   - *Purpose:* Hourly (`37 * * * *`) and manual `reap-stale-queued-runs` sweep that reports queued workflow runs older than 24 hours with verified zero jobs; it preserves the runs and their audit evidence.
3. **Matrix Verify + Auto-Cancel Concurrency (`.github/workflows/verify.yml`, `composio-v3.yml`, `secret-isolation.yml`)**
   - *Origin:* `mahoraga/verify.yml`.
   - *Purpose:* Adds `cancel-in-progress: true` concurrency groups to prevent rapid PR pushes from burning duplicate runner minutes.
4. **Cron Staggering (`.github/workflows/release-authorize.yml`)**
   - *Finding:* Four scheduled loops across `Ultron.MW` and `mahoraga` fired simultaneously at minute `:17`.
   - *Fix:* Moved `release-authorize.yml` to `7 * * * *` and scheduled the new reaper at `37 * * * *`.
5. **Cloudflare Worker Config & Cron Parity (`scripts/check-cloudflare-parity.mjs`)**
   - *Origin:* `mahoraga/scripts/cloudflare-cron-source-readback.mjs` & `cloudflare-execution-runtime.yml`.
   - *Purpose:* Statically verifies `cloudflare/edge-shield/wrangler.toml` (`name = "ultron-edge-shield"`, `crons = ["0 */6 * * *"]`) and `cloudflare/agent-relay/worker.mjs` syntax in CI.
6. **Universal Multi-Pattern Loop Engine (`.github/workflows/universal-loop.yml`)**
   - *Patterns:* Supports (1) JSON-array Matrix fan-out, (2) step-level Bash retry loops (`retry_attempts` / `retry_delay_seconds`), (3) bounded per-item iteration in a single run, and (4) reusable calls within the canonical public repository on pinned `ubuntu-24.04`. Only allowlisted read-only scripts and a single contract-validation dispatch are permitted on owner manual main; the total attempt budget is 125.

## 2. Preserved `Ultron.MW` Boundaries

- `lane-governed-task.yml` remains single-job and non-reusable (`no workflow_call`) so Hatchable's OIDC identity policy stays intact.
- All 15 workflows maintain explicit `permissions` and `timeout-minutes`.

## 3. Documented `mahoraga` Reference Notes (Read-Only)

- `mahoraga` currently has 3 workflows without `timeout-minutes` (`contract-validation.yml`, `autonomous-integration.yml`, `provision-cloudflare-zero-credit.yml`) and 3 without `concurrency` (`contract-validation.yml`, `cloudflare-lifecycle-evaluation.yml`, `provision-cloudflare-zero-credit.yml`).
- `mahoraga/sovereign-eight-hour-cycle.yml` uses durable git tag anchors (`sovereign-cycle-anchor-v2-*`) and a credit-free heartbeat preflight (`src/autonomy-heartbeat.mjs`) that can be adopted later if `Ultron.MW` adds autonomous scheduled candidate cycles.
