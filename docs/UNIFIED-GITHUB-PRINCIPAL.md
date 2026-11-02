# Unified GitHub App principal

Trackers: [#167](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167)
and [#169](https://github.com/michaeljwilliams0123/Ultron.MW/issues/169).

State: **source candidate only**. This repository does not prove a deployed
installation, credential, live token mint, Hatchable connection, mutation,
merge, or production acceptance.

## Identity is not authority

Ultron uses one intended GitHub App actor, `ultron-github-app`, installed only
on `michaeljwilliams0123/Ultron.MW`. The installation may be configured with
the union of permissions needed by approved profiles, but runtime work never
receives that union. A trusted credential service must mint a short-lived
installation token for one repository and one operation with exactly the
profile below. The policy rejects missing, mismatched, or additional token
permissions.

| Operation | Authorization | Exact token permissions |
| --- | --- | --- |
| Identity readback | Revocable standing grant | Metadata: read |
| Repair branch create/update | Bounded repair plan + standing grant | Metadata: read; Contents: write |
| Repair PR create/update | Bounded repair plan + standing grant | Metadata: read; Pull requests: write |
| Repair PR comment | Bounded repair plan + standing grant | Metadata: read; Issues: write |
| Check observation | Standing grant | Metadata: read; Checks: read |
| Exact-head Verify dispatch | Standing grant; pinned `ultron/*` ref and SHA | Metadata: read; Contents: read; Actions: write |
| Failed-run rerun or active-run cancel | Standing grant; exact run attempt and head SHA | Metadata: read; Actions: write |
| Workflow enable/disable | Fresh independent owner step-up | Metadata: read; Actions: write |
| Reversible repository setting | Fresh independent owner step-up | Metadata: read; Administration: write |
| Webhook ping | Fresh independent owner step-up | Metadata: read; Webhooks: write |

No profile admits merge, direct `main` writes, ruleset bypass, secrets,
visibility, billing, credential changes, installation changes, arbitrary
repositories, arbitrary workflows, or arbitrary REST paths.

## Per-operation contract

Every executable plan binds the owner, repository, controller source SHA,
operation, exact parameters, observed precondition, expected postcondition,
one-use idempotency key, RFC 3339 expiry, `$0` cost ceiling, and
`paidFallback:false`. A high-impact grant additionally binds that plan's SHA-256
digest, operation, installation ID, expiry, and idempotency key. Planner output,
council text, model output, scheduled work, or possession of the App identity
cannot synthesize this grant.

The executor follows this sequence:

1. Snapshot and freeze the plan so an asynchronous caller cannot change it.
2. Read durable pause/revoke state.
3. Independently read the operation-scoped token identity and effective grants.
4. Verify the standing or fresh step-up authorization as required by policy.
5. Read the named GitHub precondition, including branch/head identity for
   Verify dispatch and run attempt/head for rerun or cancel.
6. Recheck all expiries immediately before atomically reserving the attempt.
7. Send one allowlisted request without transport retry.
8. Read back synchronous settings changes; mark asynchronous Actions results
   `dispatched-unverified` until a separate observer validates the outcome.
9. Mark response loss, non-2xx results, mismatched readback, or ledger failure
   `reconcile-required`. Reconciliation reads the exact GitHub object and never
   blindly repeats the possible write.

The precondition read is a guard, not an atomic compare-and-swap with GitHub's
mutation. Deployment must exclude competing writers during the read-to-write
window for settings operations unless a specific endpoint supplies a verified
conditional-write mechanism.

## Protected release remains independent

The principal can prepare and verify work but cannot merge it. A protected head
is merely **ready for a human-controlled merge decision** when a fresh GitHub
readback proves the required checks succeeded at the exact head SHA and an
independent reviewer approved that same SHA. The App actor cannot serve as its
own independent reviewer. Green CI, a council report, a Reef probe, a source
declaration, or an installation-token readback alone does not satisfy this
release evidence.

## Activation and rollback

Activation remains a separately authorized deployment task:

- Install or reconfigure only after owner approval and inspect effective grants
  without exposing credential material.
- Keep private keys and tokens in the protected credential service, never in
  source, issues, PRs, logs, receipts, model input, or browser storage.
- Prove each profile with a reversible canary, denied over-scope cases, expiry,
  pause/revoke, response-loss reconciliation, and independent readback.
- Roll back by pausing operation admission first, revoking the installation or
  key at GitHub if necessary, and reconciling every reserved or uncertain
  attempt before resuming. Do not reset uncertain work to retryable state.

No paid service or paid fallback is part of this design. Paid spend remains
hard-zero unless a later, separately reviewed owner decision changes policy.
