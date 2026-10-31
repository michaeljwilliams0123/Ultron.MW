# Live Ultron end-to-end acceptance audit

This is the canonical **read-only, zero-model-credit** public-surface observation
workflow. It does not assert that private account access, multi-provider authority,
owner browser actions, GitBook sync, or external writes are operational.

## Entrypoints

- Automated: `.github/workflows/live-acceptance-audit.yml` runs after a successful
  `main` push Verify, each day at **09:27 UTC**, and by manual Actions dispatch.
- Script: `node scripts/live-acceptance-audit.mjs` (Node.js 22, built-in fetch).
- Unit contract: `node --test test/live-acceptance-audit.test.mjs`.
- Artifacts: `artifacts/live-acceptance/report.json` and `report.md`;
  GitHub run summary and a 14-day Actions artifact preserve the sanitized readback.
- Required GitHub Action permissions: `contents: read` and `actions: read`;
  checkout credentials are not persisted.

Every run independently reads the canonical GitHub main commit, the matching
main-push Verify job result, deployed Pages HTTP/embedded exact source SHA and
JavaScript module, production Hatchable landing page, production anonymous
admin denial, and production scheduler ingress denial. The retired Hatchable
experiment is never contacted by this Action. No POST, browser login, provider token use, workflow
dispatch, comment creation, merge or secret read is performed.

The **11 required checks** also validate the production `/api/brain/status-public`
JSON with the same parser as the UI, require the exact canonical Pages
allow-origin header, and require no allow-origin header for a separate foreign
origin. These are two credential-free GETs to the existing production route.
A working landing page cannot hide a broken status API or browser access rule.
Network unavailability stays unknown; observed HTTP/schema/CORS violations fail.
The foreign-origin header probe checks server policy; the separate real-browser
acceptance remains necessary to prove browser behavior.

## Outcome vocabulary

- `observed-healthy` — every *public* observation matched. This **never**
  means full autonomous production acceptance.
- `incomplete` — at least one public observation was absent, invalid, stale,
  unknown, or not yet available. Deployment propagation is recorded as unknown
  rather than forcing a false failure.
- `degraded` — an observed public control violated its contract (e.g., Pages
  500, unexpected anonymous administrator access, or an exact-head Verify
  failure). Script exits nonzero.
- `not-accepted` — invariant production status until private/owner acceptance
  has its own independently authenticated, authoritative receipts.

The workflow does not close issues, replay uncertain writes, mutate production
data, automatically create branches, auto-merge PRs, or install a second UI.
A positive GET does not prove a connected secret or a real external mutation.

## Current issue dispositions — October 31, 2026

The live issue bodies govern closure; [the dated acceptance summary](../ACCEPTANCE-STATUS.md)
links their scopes and evidence. This public audit does not adjudicate issue
closure. Its broad `productionReadiness: not-accepted` field can coexist with
accepted bounded milestones supported by separate owner-authenticated receipts.

| Issue | Disposition | Operator action |
| --- | --- | --- |
| [#65](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65) | Closed, completed | Preserve the scoped controlled-app receipt and its negative/no-replay evidence; investigate a new observed defect specifically. |
| [#66](https://github.com/michaeljwilliams0123/Ultron.MW/issues/66) | Closed, completed | Preserve the accepted recovery and pause/resume receipts; investigate a new observed defect specifically. |
| [#67](https://github.com/michaeljwilliams0123/Ultron.MW/issues/67) | Closed, completed | Scoped PAT connector accepted; live App identity, general delegation and another provider remain separate capabilities. |
| [#68](https://github.com/michaeljwilliams0123/Ultron.MW/issues/68) | Closed, not planned | Keep the baseline and promotion protections; reopen for a concrete candidate and bounded value evaluation. |
| [#69](https://github.com/michaeljwilliams0123/Ultron.MW/issues/69) | Closed, completed | Retain routes with platform/history consumers. A future removal requires its own evidence and PR. |

The owner's current scopes supersede older two-provider, private-account,
PC-offline, physical-hosted-kill and mandatory-route-deletion closure language.
Historical evidence records keep their original dates and limitations.
Sent/uncertain external effects stay readback-only; neither a status summary
nor an issue closure authorizes replay or expands runtime permissions.

## Single-interface architecture and follow-on implementation

The command bridge below is historical optional architecture, not a dependency
for the accepted #65–#67 scopes.

GitHub Pages is the current static UI. Its hosted execution buttons open
owner-confirmed native GitHub Issues/Actions. Hatchable provides durable
PostgreSQL queue and execution APIs, but the landing page is not yet the
accepted [Repository Operator](../ULTRON-REPOSITORY-OPERATOR.md) control plane.
Descope sign-in and Hatchable collaborator administration are separate identity
planes. The target is a gated Hatchable cutover, not a privileged token embedded
in Pages.

The target Hatchable UI must use independently verified owner identity,
CSRF/origin checks, scoped commands, durable task IDs, stop and status readback,
and no credential in Pages JavaScript, public issues, local storage or query
strings. Keep Pages transitional until live parity, negative security evidence
and rollback succeed.

## Incident decisions

- Main Verify failure: diagnose exact SHA and failed job; do not claim success
  from an older green run.
- Pages SHA behind main: first check Pages deployment/propagation, then re-run;
  never relabel stale Pages as current.
- Production owner GET returns 200 to anonymous caller: investigate the
  administration-access boundary immediately; do not bypass to force green.
- Production scheduler GET not 404: investigate route access configuration.
- External state `uncertain`: authoritative readback ONLY, never blind retry.
- Scheduled checks green but a capability's acceptance unknown: consult its
  live issue contract and record the exact missing evidence. Preserve already
  accepted scoped decisions; a new degradation needs specific incident evidence.
- Site temporarily inaccessible: report an incomplete observation, not a
  fabricated healthy response.

## Manual one-line invocation

From the repository root on Node.js 22:

```sh
node --test test/live-acceptance-audit.test.mjs
node scripts/live-acceptance-audit.mjs
```

The live script uses anonymous GETs for public endpoints and an optional
`GITHUB_TOKEN` *only* for GitHub API reads. No Hatchable owner key is needed
or requested. It prints a compact status, generates a detailed Markdown
summary and machine-readable sanitized JSON, and exits nonzero only on an
observed public degradation.

## Single production Hatchable runtime — October 29, 2026

[Consolidation and native App acceptance evidence](HATCHABLE-SINGLE-PRODUCTION-2026-10-29.md) records production v18, one active hourly scheduler, retired experimental v14 with durable owner pause and redirect, and an independently verified GitHub App-bot write/readback from a locally held credential. The hosted experiment's PEM admission failed before a write; it is **not** proof of a functioning hosted App installation. Only the PAT-backed production service remains active. The experiment project record remains available for rollback but has no cron and no independent application landing page.

The acceptance collector now makes **eight** required public-surface observations. No routine CI job should depend on the retired project's availability, visibility or permanent existence. This reduction is intentional and does not relax production's anonymous access gates or assert private capability acceptance.
