# Route consumer and cost baseline — October 28, 2026

Issue #69 follow-up to [the parity and rollback observations](ROUTING-RUNTIME-2026-10-28.md).
The [JSON snapshot](ROUTE-CONSUMERS-2026-10-28.json) records the source SHA,
registered routes, complete returned log window, timings, scheduler state and
explicit evidence limits. No request bodies, identities or private logs are
copied into this report.

## Observed production calls

Hatchable production v16 returned 69 handler logs for the last 24 hours;
the response was not truncated. All were HTTP 200. These are handler timings,
not end-to-end network latency or a replacement comparison.

| Route | Calls | Minimum / median / maximum ms | Consumer or retained purpose |
| --- | ---: | --- | --- |
| `/api/brain/tick` | 23 | 146 / 171 / 225 | Declared hourly scheduler; admits one keyed inspection and schedules bounded work |
| `/api/brain/run` | 23 | 260 / 322 / 11,543 | Scheduler continuations from tick and owner queue; executes bounded work and readback |
| `/api/brain/mahoraga` | 18 | 9 / 40.5 / 11,180 | Execution/status API; scheduled reconciliation shares its underlying library |
| `/api/brain/control` | 5 | 53 / 55 / 131 | Independent owner pause/status control |
| `/api/brain/command` | 0 | Not observed | Retained owner command facade; live external consumer not established |
| `/api/brain/tasks` | 0 | Not observed | Retained owner queue/status/control API; experiment tasks 53/54 exercised this route |
| `/api/brain/authority` | 0 | Not observed | Retained signed authority admission; live delegated-grant consumer not established |
| `/api/brain/events` | 0 | Not observed | Retained HMAC event bridge; external caller and live configuration remain unverified |

The platform log does not supply caller identity, so an invocation is not an
independent user-identity attestation. Zero calls in a finite window does not
establish a dead route. Five MCP files remain deployed; their independent
OAuth client usage is not visible in this HTTP route log.

The live scheduler's last-fired timestamp advanced to 18:40:02 UTC with no
last error and 158 recorded runs over seven days. The configured expression is
`17 * * * *`; the observed fire is not at minute 17, so this snapshot proves
continued wakeups, not exact cron punctuality. The seven-day error query
returned an authority 503 on October 27 and a tick 503 on October 23; their
causes were not established by those body-free log records.

`tick` and `run` are separate for a documented reason: the tick's short
scheduler budget only admits work, while the continuation handles bounded
execution. Collapsing them requires a separate runtime-budget/recovery
comparison. No replacement or deletion is approved by these measurements.

## Published cost boundary

The official [pricing table](https://hatchable.com/pricing), retrieved October
28, lists Free at 0 USD/month and Builder at 12 USD/month. Free includes
100,000 function calls, 10 compute hours, 25 run hours and 2 database hours
per month account-wide. Additional Builder capacity blocks cost 12 USD each.
The [browser reference](https://hatchable.com/features/browser) includes managed
Chromium in every plan and records operations, browser time and returned bytes
against usage, without a separate browser allowance purchase.

These are current published quotes. Project visibility `personal` is not proof
of the account's billing plan, remaining capacity or invoice. This audit
does not authorize an upgrade and did not create a project, route or paid
control plane. Actual billed-cost savings and replacement latency parity
remain unmeasured because no route was replaced.

## Remaining external evidence

GitBook has no available dedicated connector in the plugin search. A direct
workspace visit reached its sign-in screen; authenticated sync status is
therefore unverified. Preserve its configuration and handbook until a signed-in
read shows the exact repository, branch, `gitbook/` root, sync direction and
latest commit. Do not change Git Sync wiring or install an integration merely
to make the status appear complete.
