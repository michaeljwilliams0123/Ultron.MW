# Task 4 — Durable idempotent GitHub write executor

Scope: `michaeljwilliams0123/Ultron.MW` only. This source-only implementation
adds `src/engine/durable-executor.mjs`, `test/durable-executor.test.mjs` and
`cloud/hatchable/migrations/0039_github_idempotent_executions.sql`.

## Trust boundary / input contract

`executeIdempotentGitHubWrite(taskContext, token, persona, gitOperation, services)`
expects task metadata with stable `taskId`, `targetBranch` (`canary/`, `ultron/`
or `feature/`), and a **SHA-256 `operationDigest`** bound by the Task 2
cryptographic interceptor to the authorized request. `persona.role` must
identify one of seven Council roles. Task 4 **does not sign, mint, or verify
owner grants on its own**: `services.authorization.verify(intent)` must be a
trusted server-side adapter for the Task 2 signature + nonce/revocation gate,
returning `{ verified, operationDigest, repository, targetBranch, personaRole,
expiresAt }`. It must be repeatable without consuming a one-time grant twice,
and must reject expired/revoked grants; the executor rechecks immediately before
dispatch. Never forward caller-provided `authorized:true` as the verifier.
The executor constructs the immutable persona attribution from the
verified Council role; caller-provided `authorName` and extra persona fields
are not forwarded to the mutation.

`services.db` is a PostgreSQL client implementing `query(sql, params)`. Use the
existing Hatchable PostgreSQL connection and apply migration 0039 before
activating the executor; do not create a second source of authority. The
optional `services.remote.inspect({token,intent})` is ONLY for a trusted
server-side GitHub readback adapter and tests. By default the module uses
GitHub REST with the supplied short-lived token; it does not persist or log
that token. `gitOperation` must be a pre-admitted, bounded GitHub mutation,
not arbitrary shell or general-purpose admin access.

### Integration illustration

```js
const receipt = await executeIdempotentGitHubWrite(
  {taskId, targetBranch, operationDigest, repository:'michaeljwilliams0123/Ultron.MW'},
  scopedToken,
  {role:'steward', authorName:'Ultron Steward'},
  async ({token, targetBranch, operationMarker}) => {
    // Perform the already-authorized branch/commit mutation through GitHub.
    // Include `operationMarker` as an exact line in the target HEAD commit
    // message; do not treat the GitHub API response as final verification.
  },
  {db, authorization:{verify:verifiedGrantForIntent}}
);
// Deliver only a `success`, `reconciled_success`, or `recovered_success`
// receipt with remoteVerified=true to Task 5 as a verified branch effect.
```

## Crash / replay state machine

`reserved → in_flight → completed` on verified HEAD readback and confirmed
PostgreSQL receipt SELECT. `reserved/in_flight → reconcile_required` on unknown
remote outcome or nonmatching branch. `reconcile_required → completed` only on a
subsequent positively matched remote HEAD observation. Terminal completed
records are immutable. Both `(repository,target_branch)` and the idempotency
key are unique; a changed operation digest, persona, or repository with the
same key is a hard conflict.

A branch existing by itself is **not** success. The exact HEAD commit must have
`Ultron-Operation-Digest: <operationDigest>` as its own line. If the branch
exists with a different marker, hold for reconciliation.
The GitHub reference is fetched again after the commit object to reject a
branch that moved during readback; even this is point-in-time verification,
not a claim that the branch can never change again. A 401/403, rate
limit, 5xx, or network error is *not* proof that the branch is absent. A
worker that loses an API acknowledgment does not reissue the mutation: it
rechecks remote state and durable state. A crashed worker's *still-reserved*
intent is safe for another authorized worker to resume: an atomic PostgreSQL
`reserved → in_flight` compare-and-set elects exactly one dispatcher. An
`in_flight`/uncertain attempt is **not** replayed, even when GitHub says the
branch is absent. A duplicate observer does not mutate an active `in_flight`
record, and an INSERT acknowledgment loss is reconciled via independent SELECT.
Every GitHub readback request has a 10-second abort deadline.
If the dispatch CAS acknowledgement is lost, Task 4 returns a non-success
reconciliation outcome and independently rereads the record; it never assumes
CAS ownership or invokes the provider write. An expiring/revoked approval is
rechecked **after** the CAS and immediately before dispatch. Unknown in-flight
outcomes remain fenced rather than blindly replayed.

Receipt status proves **only the authorized branch/commit effect**, not PR
creation, CI completion, independent review, a merge, or deployment. Those
operations need their own independently verified Task 5 evidence and gates.

## Verification

Run `node --test test/durable-executor.test.mjs`. Fast tests use a deterministic
in-memory PostgreSQL-shaped adapter. When `@electric-sql/pglite` is installed,
additional tests exercise the real migration, unique claims, durable SQL,
and terminal immutability. Full repository CI is required before merge.
