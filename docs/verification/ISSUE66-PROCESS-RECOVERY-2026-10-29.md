# Issue #66 — subprocess crash recovery with real PostgreSQL

The protected Verify job now runs the complete existing `runOne` worker in
disposable Node subprocesses against its PostgreSQL 16 service. The worker and
persisted owner-control implementation are loaded from the PR source. Only the
objective implementation is replaced by an explicitly isolated read fixture;
there is no provider credential, website login, external write or production DB.

The parent executes the worker's actual parameterized statements using PostgreSQL
`PREPARE` / `EXECUTE`. It kills the child with `SIGKILL` at an observed boundary,
then starts a different process and independently queries committed task/event
state. A unique schema isolates each case and is removed at teardown.

| Case | Required independently read result |
| --- | --- |
| Kill during an objective | Live lease cannot be stolen; after test-only expiry, attempt and fencing generation advance, with one recovery and one completion receipt |
| Kill after completion commit, before its reply | Restart stays idle; committed result and single observation remain identical; no objective replay |
| Drop acknowledgement after real SQL commit | One completion statement, one readback and one objective call; matching fenced receipt permits `done` |
| Old worker finishes after replacement | Old worker returns `lost-lease` and cannot overwrite replacement state or append a second observation |
| Kill on final permitted attempt | Recovery blocks the task without executing the objective again |
| Persisted owner pause after crash | No claim or lease recovery while paused; controlled resume permits recovery |

Run in the same disposable PostgreSQL 16 Docker service used by Verify:

```sh
ULTRON_POSTGRES_TEST=1 node --test --test-concurrency=1 test/hatchable-process-recovery-postgres.test.mjs
```

Without that opt-in, the six cases are explicitly **skipped**, never reported as
passed. The ordinary source suite remains available through
`node scripts/verify.mjs`. The CI service identifies exactly one
`postgres:16-alpine` container; this harness accepts no production connection URL.

This closes the previous test-coverage gap between executing extracted SQL and
terminating a process that runs the real worker. Test leases are expired by an
explicit isolated-schema UPDATE to avoid waiting 90 seconds; this does not prove
wall-clock lease timing. Retrying the unfinished **read fixture** is expected;
the same rule must never be generalized to external provider writes.

Issue #66 remains open for a real hosted production worker interruption, external
provider response-loss reconciliation, independently established owner-device
offline execution, and budget/retention/SLA acceptance. Existing uncertain
Mahoraga actions remain untouched. This PR adds CI acceptance; it requires no
Hatchable redeployment and does not add a cloud endpoint or scheduler.
