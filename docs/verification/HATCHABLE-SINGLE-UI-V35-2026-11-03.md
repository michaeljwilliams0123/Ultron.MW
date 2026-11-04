# Hatchable single-owner UI — v35 deployment evidence

Date: 2026-11-03 America/New_York / 2026-11-04 UTC
Scope: UI consolidation and protected read-only cloud task admission
Source: [PR #256](https://github.com/michaeljwilliams0123/Ultron.MW/pull/256), squash merged as `12a1227e66ffd9520b61e91007dc5d8ab808009c`
Host: `https://ultron-mw-cloud.hatchable.site`
Production: Hatchable v35, 66 deployed files, 14 API functions

## Observed live acceptance

- Primary root `/` displays protected cloud controls plus links to `/workspace.html`; workspace links back to root under the **same Hatchable origin**.
- `/workspace.html` provides the previously Pages-hosted Brain, Learning and Systems panes. Managed Chromium verified both tab switches and two initialized Codex author cards.
- Nine first-party JavaScript files returned HTTP 200 with `application/javascript` MIME type, including the module-import dependency chain.
- Protected owner APIs: anonymous GET to `/api/brain/tasks`, `/api/brain/autonomy`, and `/api/brain/control` returned HTTP 401; ordinary-member task read returned HTTP 403; admin-tier GET for all three returned HTTP 200.
- Existing `/api/brain/status-public` returned HTTP 200 with `ownerOperations=protected`.
- Live safe canary task `#778`: owner-tier `POST /api/brain/tasks` with `action=queue`, `objective=repo.inspect`, and stable key `owner-ui-inspect-cutover-20261103-01` returned HTTP 202. The same request returned existing task `#778` with `created=false`; PostgreSQL task readback showed a single done task, one attempt, and GitHub source SHA `8530f25885dab764d4eb03fcf1bc76fb07c4487c` at observation time. This tests hosted read-only task admission and duplicate suppression, not PR-creation acceptance.
- Exact PR-head GitHub CI passed the test job, fixed comparison, and associated checks after updating the feature branch with latest protected main. Repo and Hatchable static source were imported from the pinned PR head and matched the later branch update for all 11 migrated files.
- Hatchable `dry_run_deploy` reported zero blocking errors. The six dynamic-SQL scanner warnings were retained rather than suppressed.

## Operating boundary

- **Hatchable** is now the recommended owner UI entrypoint for cloud controls and the migrated legacy workspace. **GitHub** remains canonical for source/PR/CI and protected merges.
- GitHub Pages remains live and unchanged as the rollback surface; no deletion or redirect was performed.
- The new server-hosted UI is public to load, while privileged task, profile and control APIs remain owner protected. Do not place secrets in GitHub issues or public Pages.
- The browser vault uses origin-scoped storage. Existing GitHub Pages browser memory is **not automatically transferred** to Hatchable; use the established encrypted export/import flow if needed.
- Owner-selected Release autonomy mode is **a preference only**; its backend reports `executionAuthorized=false` and `runtimeEnforced=false`. $0 paid-spend limit remains unchanged.

## Remaining acceptance — intentionally not represented as complete

The checks above **do not** establish the full `#170` authenticated end-to-end repair flow from Hatchable admission through protected PR, exact-head CI, linked PostgreSQL/GitHub postcondition, browser-owner MFA/session-expiry/CSRF negative tests, mobile/desktop equivalence, or successfully exercised rollback. `#194` future objective/scenario/council/integration panels likewise remain an ongoing workstream. Keep these issues open until separately observed, then consider retiring GitHub Pages in a distinct protected change.

## Rollback

If the new UI misbehaves, continue using the existing Pages workspace at `https://michaeljwilliams0123.github.io/Ultron.MW/` and the independently protected Hatchable backend. Do not delete or overwrite database/receipt rows. Investigate the v35 deploy in Hatchable History before changing runtime files. Roll back only after checking whether newer database migrations or external actions require forward repair.
