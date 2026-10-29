# Mahoraga response-loss recovery

The Mahoraga adapter previously returned `uncertain` when its PostgreSQL
`observed` transition committed but the database driver lost the reply. The
external result was already independently observed and durably saved; the
caller still received an ambiguous status.

On that exception, the adapter now performs one read-only query. It requires
the original action ID, task ID, action key, operation, exact JSONB request,
`observed` state, and exact JSONB provider result to match simultaneously.
A match returns `observed` with `readback: committed`. Missing, mismatched or
unavailable evidence remains uncertain. This path never sends another provider
write, changes credential mode or modifies an existing request.

## Executable acceptance

The ordinary regression first reproduced the incorrect `uncertain` result.
The protected Verify database step also runs
`test/mahoraga-process-recovery-postgres.test.mjs` against PostgreSQL 16 and an
actual HTTP service bound exclusively to `127.0.0.1`:

| Fault | Required result |
| --- | --- |
| HTTP service commits an issue, then destroys the response | New process reads the provider state and reconciles exactly one write |
| Sender is killed with SIGKILL after provider commit | Durable `sent` action reconciles without another POST |
| Sender is killed after send admission but before HTTP dispatch | Action remains uncertain with zero provider writes; restart never sends it |
| PostgreSQL observation commits, then its reply is dropped | One exact readback accepts the committed result; later invocation reuses it |
| Persisted result changes before the readback | Mismatch remains uncertain |
| Independent observation readback is unavailable | Caller remains uncertain; subsequent invocation does not repeat the write |

Each sender is a fresh Node process importing the actual adapter. The existing
transport injection point maps its expected GitHub repository URL to the
loopback fixture and refuses all other targets. Only a clearly synthetic
credential exists; no Authorization header is forwarded. The provider fixture
remains running while sender processes die. Its independent HTTP state endpoint
counts actual POSTs and exposes the committed fixture object. PostgreSQL
independently verifies one correlated task, action and admission receipt.
The same-key reuse and conflicting-request rejection cases check the provider
POST count rather than trusting an adapter message.

Use the same disposable `postgres:16-alpine` Docker service as Verify:

```sh
ULTRON_POSTGRES_TEST=1 node --test --test-concurrency=1 test/mahoraga-process-recovery-postgres.test.mjs
```

Without the explicit opt-in, these six cases are skipped. Unique schemas are
removed after each case. No production connection URL is accepted.

## Evidence boundary

These are real HTTP effects, SQL commits and killed sender processes in isolated
CI. The HTTP service is an intentional provider fixture, not GitHub; its actor
is `isolated-provider-fixture`. The test does not prove live GitHub App grants,
real credential revocation, hosted production interruption, owner-device-offline
operation, or full issues #66/#67 acceptance. No historic uncertain production
action is replayed.

Production fault injection through dynamically evaluated fetched source was
rejected by automatic approval review because it could expose credentials or
cause live side effects. This acceptance uses isolated CI instead. Deployment
of the reviewed fix, if performed, uses the ordinary versioned Hatchable file
and deployment tools after protected source checks; it does not enable a fault
injection endpoint or load arbitrary source at runtime.
