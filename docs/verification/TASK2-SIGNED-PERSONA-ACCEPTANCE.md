# Task 2 — signed Council persona admission: final source acceptance

**Scope:** [PR #362](https://github.com/michaeljwilliams0123/Ultron.MW/pull/362). This is the acceptance record for the *source implementation* of `enforceSignedApprovalAndTagPersona`, not proof of a deployed operator or permission to execute a live external write.

**Owner decision:** Source may be reviewed and squash-merged by `michaeljwilliams0123` after checking the exact current head, required GitHub checks, and repository protections. The owner is the only required human approver under the superseding 2026-11-08 issue #167 policy. Automated security/technical checks, expiry, scoped authorization, replay protection, stop/revoke and readback remain requirements. **Do not auto-merge or deploy.**

## Definition of done — this PR's source scope

- [x] Exact operation plan is immutable and SHA-256 bound to the signed grant, with no trust configuration taken from inbound task metadata.
- [x] HMAC-SHA256 and P-256 owner signatures use the pre-existing verifier, its five-minute freshness rules, and canonical signed fields.
- [x] Replay/nonces are consumed by migration 0037's `brain_github_approval_nonces` using PostgreSQL unique-key atomic insert-if-absent; failures deny token issuance.
- [x] Council role must be one of Builder, Skeptic, Steward, Predictor, Generator, Sentinel or Companion; it is signed as part of the exact plan.
- [x] The requested operation is from the canonical GitHub operation profiles; the exact repository ID `1424939667` and operation-specific token permission map are required.
- [x] A trusted server-only Task 1 token factory returns a structured token record, whose installation ID, operation, repository, permissions and expiry are checked before a caller receives the token.
- [x] Trusted clock/approval freshness and issued token expiry are rechecked **after** asynchronous issuance. Provider exceptions do not disclose credential strings.
- [x] Token stays available only to the trusted in-process executor; ordinary JSON/spread and `util.inspect(...,{showHidden:true})` cannot accidentally serialize it. This is *not* a protection against malicious trusted code that directly reads `.token`.
- [x] Signed execution payload and commit attribution are frozen; GitHub App principal identity is not fabricated as seven independent App accounts.
- [x] Negative regressions cover tampered signatures/roles/permissions/plans, malformed tokens, replay, DB loss, provider failures, expiration, object mutation during awaits, and debug-print credential exposure.
- [x] **Actual PGlite SQL concurrency:** 24 simultaneous identical signed approvals admit exactly one and reject 23; one nonce row, one token exchange.
- [x] **RED → GREEN evidence** preserved in PR #362; no direct Github write, merge, paid call, secret change, or production migration made by this PR.

## Evidence, pinned to tested implementation

| Evidence | Observed result |
| --- | --- |
| [Task 2 final exact-code Core Verify #42761752181](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42761752181) | `5aba311c9685449f1c3ef50f931912e91df72579`: 1,757 passed, 0 failed, 18 skipped; separate PostgreSQL acceptance 40/40. Test, fixed-comparison and attested-receipt checks green. |
| [Task 2 RED #42761558232](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42761558232) | Reproduced debug-inspection credential exposure; fixed in `5aba311c`. |
| [Integration #367 Core Verify #42763190439](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42763190439) | 1,852 pass / 0 fail / 18 skipped, 40/40 PostgreSQL; real module composition with synthetic provider. Exact integration SHA `59ffe8edf2277e3c1a74e93eff490a017a6cb3b0`. |
| [Broader integration #368 Core Verify #42763365453](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42763365453) | 1,850 pass / 0 fail / 18 skipped, 40/40 PostgreSQL; nine source-module scenarios including replay, lost ACK, revoked approval, parent/tree tamper, moving branch ref. Exact source snapshot is identified on #368. |

All these checks prove only their pinned Git trees. Subsequent code changes to any independent PR require fresh checks. Council and Reef workflow success does not prove seven independent model reviews, a second human approval, or live GitHub App authentication.

## Integration contracts and merge order

1. [#361](https://github.com/michaeljwilliams0123/Ultron.MW/pull/361): one verified GitHub App factory, returns scoped `{token,operation,repositoryId,installationId,permissions,expiresAt}`.
2. **[#362](https://github.com/michaeljwilliams0123/Ultron.MW/pull/362):** one-use signed owner admission with immutable persona and scoped execution payload.
3. [#363](https://github.com/michaeljwilliams0123/Ultron.MW/pull/363): prepare-only headless dispatcher, no side effect while preparing.
4. [#365](https://github.com/michaeljwilliams0123/Ultron.MW/pull/365): PostgreSQL idempotent executor, exact commit trailer and remote reconciliation, migration 0039.
5. [#364](https://github.com/michaeljwilliams0123/Ultron.MW/pull/364): create-once, local-only audit with recovery/uncertainty statuses, never an external proof.
6. [#366](https://github.com/michaeljwilliams0123/Ultron.MW/pull/366): five-stage conductor, *draft* until its own source and runtime integration decisions are satisfied.

Owner may squash-merge each individually **only after confirming the combined post-merge tree still passes required checks**. Do not squash-merge duplicate aggregate test-only [#367](https://github.com/michaeljwilliams0123/Ultron.MW/pull/367) or [#368](https://github.com/michaeljwilliams0123/Ultron.MW/pull/368); port their integration-only regression tests into an accepted source PR before discarding them.

## Separate live production acceptance — still OPEN

Canonical tracker: [#167](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167); advanced user-facing E2E tracker: [#285](https://github.com/michaeljwilliams0123/Ultron.MW/issues/285).

- [ ] Verify migrations 0037 and 0039 and immutable receipt constraints in the **actual Hatchable PostgreSQL**; ensure versioned deployment/rollback readback.
- [ ] Bind real App installation, P-256 owner signer, trusted clock, durable nonce and executor ledger, scoped token factory, stop/revoke authorization, and cost guard in the existing **Hatchable** control plane; no user-controlled trust adapters.
- [ ] Run one owner-approved **live** bounded GitHub canary with authenticated App principal, constrained branch/ref/operation digest, actual provider mutation, independently refreshed provider-side SHA/parent/tree/HEAD readback, and exact persistent receipt.
- [ ] Demonstrate expired/revoked grant denial, concurrent duplicate delivery, lost-ACK crash/reconciliation and owner pause without duplicate external writes or leaked credentials.
- [ ] Confirm exact deployed source, protected branch policies, no unauthorized merge, and `$0` incremental paid usage.
- [ ] Link runtime evidence and decision to #167/#285. A source PR squash merge or CI pass does **not** close either tracker or establish live production acceptance.

**Status:** Task 2 source acceptance **PASS**, owner squash review **PENDING**, production activation **NOT ACCEPTED**.
