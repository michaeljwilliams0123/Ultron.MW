# Routing runtime and rollback observations — October 28, 2026

Related issues: #69 (route retirement), #65 (owner browser acceptance), and
#66 (hosted execution/recovery). The accompanying
[JSON record](ROUTING-RUNTIME-2026-10-28.json) contains sanitized deployment
manifests, task/event identifiers, responses, timings and evidence limits.
It contains no credentials, approval challenges, session cookies or preview URLs.

## Source and runtime parity

The 316-file repository snapshot was checked byte for byte against Git blob
SHAs at `8f4ea384d953b115475bb4e2fc382e2f9e917e61`. The existing parity verifier
then compared SHA-256 hashes and byte sizes for every runtime file against
Hatchable's deployed manifests. Production v16 and experiment v9 both matched:
38 files each, zero missing, extra or changed files. Experiment v11 restored
the same complete manifest after the drill below.

| Surface | Source/runtime observation | Disposition |
| --- | --- | --- |
| Eight `api/brain/` handlers | Registered in both manifests; Mahoraga, run, tick and control have actual recent invocations | Retain |
| Five MCP tools | Captured in deployed files; `[mcp] enabled=true`; client OAuth invocation not tested here | Retain declared entrypoints |
| Eleven SQL migrations | Captured in both manifests; deploy consumes migration history | Retain history |
| Root `lib/` pool | Actual handlers import it by Hatchable's project-root namespace | Retain referenced modules |
| Pages UI | Managed Chromium rendered the existing app shell; deployment run 40708842049 succeeded for the exact source SHA | Retain single UI |
| GitLab mirror | Independent GitLab branch read returned the same protected `main` SHA; mirror run 40708990259 completed its exact-SHA readback step | Retain recovery |
| GitBook | Source configuration and handbook remain; no authenticated live sync readback available | Retain, runtime unknown |

The old inventory's seven no-literal-reference candidates were the Mahoraga
API/MCP entrypoints and five migration files. Platform routing and deployment
consume these files without JavaScript import edges. The corrected audit also
resolves `lib/` imports and includes TOML configuration. None of those seven
files is dead code. No route was removed or became deletion-eligible.

## Failure injection and exact restoration

Only the existing isolated experiment project was deployed during this drill.
The baseline read-only owner-control GET returned HTTP 200, paused=false,
control version 5. Production retained v16 throughout.

1. Verify all experiment WIP file hashes match deployed v9 before editing.
2. Inject an explicit HTTP 503 into the experiment's control GET. Keep its
   declared admin access, POST control action, workers and data unchanged.
3. Dry-run validation succeeds. Deploy v10; observe HTTP 503 with the exact
   `issue69-staging-rollback-drill` marker.
4. Restore the original source, validate, then deploy v11. Compare all 38
   deployed hashes and sizes to v9: identical. GET returns HTTP 200 with the
   original paused=false, control version 5 and unchanged update timestamp.

This is a forward deployment of the exact prior code, not a database downgrade.
`run_function` exercises latest written files; WIP hashes were bound to the
respective deployment manifest before interpreting those responses as evidence
for that bundle. An authenticated external HTTP browser read of the owner-only
route was not performed.

Dry-run emitted two pre-existing missing-table warnings for `control` and
`gate`. Both names are CTEs declared in the same SQL statements, not missing
physical tables. No schema was added to silence those warnings.

## Durable tasks, idempotency and atomic rollback

On restored experiment v11, the owner API queued `repo.inspect` (task 53) and
`site.render` (task 54). The real scheduler completed each in one attempt and
fencing generation 1. Independent PostgreSQL readback returned `done`, the
exact main SHA, the live Pages app shell, and event IDs 70–75 for owner-queued,
claimed and observed transitions. Re-admitting the repository task with the
same key returned task 53, created=false and immediate_scheduled=false.

A separate live PostgreSQL transaction test first committed one isolated
canceled task and correlated event as a positive control. After removing only
those generated fixtures, a second transaction inserted the same pair and
deliberately divided by zero. The expected SQL error occurred; independent
queries found zero task and event rows. Finally, cleanup queries independently
confirmed zero remaining fixture rows. These transactions used the managed
database directly; they do not claim external-write response-loss recovery.

## Browser and acceptance limits

Managed HeadlessChrome 154 rendered public Pages with DOM headings and a
273,533-byte screenshot (digest in JSON). This is a real cloud browser
observation and durable read-only browser task, not a completed computer-use
objective. Hatchable documents a Puppeteer page allowlist without the
Playwright locator, file selection, request interception and disposable
context APIs required by the existing transfer driver. No adapter bypass,
synthetic owner challenge or new UI was introduced.

Fresh owner-authenticated transfers, takeover and the browser negative suite
still require the authorized Playwright host and independent human action
approval described in `scripts/owner-browser-run.mjs`. Do not replay the old
GitHub comment canary. No private account was changed in this observation.

Issues #65, #66 and #69 remain open. This evidence advances parity, deployment
restoration and read-only runtime acceptance. It does not establish priced
costs, replacement latency parity, full crash/restart acceptance, GitBook live
sync, or verified-dead-code cleanup. API timings here are single observations,
not performance comparisons or service-level guarantees.
