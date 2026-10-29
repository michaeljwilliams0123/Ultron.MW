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

## Issues: executable next evidence to collect

### #67 — capability and external-write authority (P1)

Current October 28 independent production SQL showed **2 observed**, **1
uncertain**, **1 prepared** Mahoraga actions; `capability_attempts` and
`brain_authority_grants` both had 0 rows. The hourly scan keeps the
ambiguous action alive for readback without re-sending it. These are audit
observations, not promises that they will stay at those counts.

1. On an authenticated Hatchable owner session, read only `id, operation,
   state, attempt_started_at, last_scanned_at` from `mahoraga_actions`.
2. For the uncertain `issue.create`, compare its stored keyed marker with the
   independently retrieved Mahoraga issue page(s) and expected actor. Never
   issue another POST on `sent`/`uncertain`; absence in a truncated result is
   not evidence that no write occurred.
3. Bind authorized, separate provider identities to their *actual* scopes,
   receipt paths, and revocation state. Show two independently authenticated
   provider operations, one approved minimal write, and negative
   cross-provider/denied-action cases. Persist non-secret typed receipts.
4. Inspect the `prepared` action's eligibility and stop status before taking
   any action. A stale prepared action must not monopolize backlog scanning.
5. Resolve #67 only when live actor identity, scope, idempotency, response-loss
   reconciliation, stop/revocation, and two-provider acceptance are evidenced.

### #65 — authenticated browser execution (P1)

The real Playwright path remains `scripts/owner-browser-run.mjs`, with
`docs/verification/OWNER-BROWSER-ACCEPTANCE.md` as its operator runbook.
The Hatchable managed Chromium render is an important *read-only* success,
but not a substitute for owner-operated browser approval, MFA takeover,
upload/download and independent persisted destination readback.
Do not silently switch this run to cloud Puppeteer if required Playwright APIs
are unavailable. Do not put credentials, cookies, screenshots or private plans
in public Actions artifacts.

### #66 — hosted recovery (P2)

The Hatchable experiment v9 → injected-failure v10 → exact-restoration v11
drill and database rollback proved useful bounded outcomes.
Still collect a distinct crash/restart, uncertain remote-write response-loss,
owner device offline and explicit budget/retention acceptance run. Preserve
production v16 and rollback boundaries during experiment validation.

### #68 — evaluated learning (P1)

`held-out-acceptance.yml` supports explicit frozen baseline/candidate SHA
comparison. Separately record independently scored novel tasks, their
prediction-before-result time, comparable cost, negative cases, and promotion
provenance. A deterministic standby tick or a CI-only seeded dataset does not
prove new cognitive capability or always-running inference.

### #69 — source-to-runtime and UI parity (P2)

Use `scripts/audit-route-references.mjs`,
`scripts/verify-hatchable-parity.mjs`,
`docs/verification/ROUTING-RUNTIME-2026-10-28.md`, and
`docs/verification/ROUTE-CONSUMERS-2026-10-28.md`. Existing runtime
evidence found 38 matching production/experiment files, no safe deletion
candidates, and no authenticated GitBook sync readback. Do not remove platform
routed files merely because they lack JavaScript import edges.

## Single-interface architecture and follow-on implementation

GitHub Pages is the canonical static UI. Its current hosted execution buttons
open owner-confirmed native GitHub Issues/Actions. Hatchable provides durable
PostgreSQL queue and execution APIs, but the landing page is not itself an
authenticated Pages→Hatchable command bridge. Descope sign-in and Hatchable
collaborator administration are separate identity planes.

To provide one *effective* UI without a second frontend: implement a
short-lived, server-side authorized handoff with independently verified owner
identity, CSRF/origin checks, scoped commands, durable task IDs, stop and
status readback, and no token in Pages JavaScript, public issues, local storage
or query strings. Before any new control bridge, demonstrate exact request
authorization and positive/negative API acceptance on the experiment.

## Incident decisions

- Main Verify failure: diagnose exact SHA and failed job; do not claim success
  from an older green run.
- Pages SHA behind main: first check Pages deployment/propagation, then re-run;
  never relabel stale Pages as current.
- Production owner GET returns 200 to anonymous caller: investigate the
  administration-access boundary immediately; do not bypass to force green.
- Production scheduler GET not 404: investigate route access configuration.
- External state `uncertain`: authoritative readback ONLY, never blind retry.
- Scheduled checks green but external acceptance unknown: retain #65–#69 open.
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
