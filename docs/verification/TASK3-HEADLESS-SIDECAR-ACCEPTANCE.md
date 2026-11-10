# Task 3 — Headless Sidecar Dispatcher: Acceptance and Handoff

**Scope:** PR [#363](https://github.com/michaeljwilliams0123/Ultron.MW/pull/363), `scripts/execute-autonomous-task.mjs` and its three test modules.  
**Acceptance baseline:** code head `10e164e968bd726df9cb1a04b9f02405f4675e2d` (2026-11-10).  
**Decision:** **Task 3 source-level contract VERIFIED**; **five-stage production execution NOT ACCEPTED**. This note is a review/merge handoff, not a release authorization.

## Scope-specific acceptance (concluded)

- [x] **Direct CLI:** accepts one bounded objective, applies the default canary for empty input, sets `requiresResponse: true` and `enforceSignedApproval: true`, and invokes the graph through the ESM interface only in direct-execution mode.
- [x] **Fail-closed execution:** rejects invalid inputs, missing graph/export or unavailable dependencies; rejects plan-only results and explicit denied production acceptance. A zero exit requires a successful execution status **and** `productionAccepted === true`. The flag alone is **not** cryptographic authorization.
- [x] **No credential exposure in CLI output:** outputs only a bounded status and boolean production-acceptance indicator; never serializes arbitrary graph responses or embeds provider exception contents.
- [x] **Collision-resistant identity and bounded scope:** full UUID-bearing direct task IDs/branches, validation of task metadata and isolated canary namespace; no direct GitHub write or token issuance in this module.
- [x] **Conductor-compatible prepare-only handoff:** `dispatchHeadlessTask.supportsPrepareOnly === true`; in `prepareOnly: true` mode, accepts only validated `taskId`, `targetBranch` (`ultron/canary-*`), 40-hex `sourceSha`, 64-hex `operationDigest`, and `requiresResponse === true` / `enforceSignedApproval === true`.
- [x] **Pure preparation:** returns frozen `{stage:'prepared',taskId,targetBranch,sourceSha,operationDigest}` without calling the graph, clock or identifier factory. No `authorized`, `token` or signature claim is generated; malformed/unexpected options and accessor properties fail closed.
- [x] **Automated evidence:** regression tests cover direct CLI loading, missing graph versus missing nested import, secret-shaped output, incomplete/denied outcomes, prepare-only handoff, invalid scope/flags, and nonexecution before authorization.
- [x] **No widening of authority:** no secret changes, new dependencies, new app identities, shell execution, implicit repository writes, deployment, or merge in this PR.

## Exact-head verification evidence

Verified candidate `10e164e968bd726df9cb1a04b9f02405f4675e2d`:

| Evidence | Outcome |
| --- | --- |
| [Core Verify #42762319715](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762319715) | **PASS**: `test`, `fixed-comparison`, `attested-receipt` |
| Full JS syntax + regression stage inside Core Verify | **PASS:** 1,780 tests reported, 1,762 passed, 18 skipped, zero failed |
| PostgreSQL-backed acceptance replay/conflict stage | **PASS:** 40 passed, zero failed |
| [Council #42762319643](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762319643) | **PASS** (advisory; not an independent production signoff) |
| [Reef protocol probe #42762319673](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42762319673) | **PASS** (probe; not a release approval) |

The direct CLI graph-handoff tests use isolated fixture modules. They do **not** demonstrate that `src/autonomy-orchestrator.mjs` is deployed or that a live grant, GitHub mutation, PostgreSQL recovery or production postcondition succeeded.

## Non-goals and outstanding cross-PR acceptance

- [ ] **Task 1 / #361:** GitHub App installation principal and least-privilege operation token verified at execution time, without exposing secrets.
- [ ] **Task 2 / #362:** real owner-signed grant, trusted key, expiry, scope and PostgreSQL nonce replay enforcement, injected from trusted Hatchable runtime (never user JSON).
- [x] **Task 3 / #363:** bounded CLI and prepare-only data contract implemented and source-tested as above.
- [ ] **Task 4 / #365:** durable reserve-before-write, same-key reconciliation, no replay after uncertain acknowledgement and **provider-side remote readback** of exact operation digest/commit SHA.
- [ ] **Task 5 / #364:** local immutable audit receipt linked to Task 4, clearly identified as **local evidence** rather than remote verification; reconcile `reconciled_success` / `recovered_success` status contracts if required by conductor.
- [ ] **Conductor / #366:** five real production stages wired to one trusted runtime; one explicitly owner-authorized bounded canary, denied/expired/replayed grants, response-loss recovery, independent remote readback and exact-head CI.
- [ ] **Runtime release gate:** owner-controlled review/merge, migration readiness, Hatchable integration and rollback, verified live identity and $0 incremental paid spend; only then consider production acceptance.

**Important:** `src/autonomy-orchestrator.mjs` is absent from `main` at this acceptance baseline. The direct CLI intentionally exits nonzero without a compatible graph. The prepare-only path can be reviewed/merged as a **safe isolated component** while the full production execution lane remains held. This separation does not waive any user or repository security control.

**Tracking:** [#366 five-stage conductor](https://github.com/michaeljwilliams0123/Ultron.MW/pull/366), [#167 Hatchable-first repository operator](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167), [#183 durable lifecycle](https://github.com/michaeljwilliams0123/Ultron.MW/issues/183), [#204 universal evidence contract](https://github.com/michaeljwilliams0123/Ultron.MW/issues/204), [#285 advanced end-user execution acceptance](https://github.com/michaeljwilliams0123/Ultron.MW/issues/285).

## Owner review and squash-merge handoff

1. Review PR #363's four code/test files and this acceptance record; compare the exact head and required status checks.
2. If satisfied with the **scoped source-level** acceptance, squash-merge #363 to `main` yourself. A merge is **not** a production execution acceptance or a deployment instruction.
3. Re-run final integration checks against the actual combined Task 1–5 merge heads in #366; attach owner-grant, nonce, execution, audit and independently observed external postcondition receipts before promoting the cloud pipeline.

Do not infer a production release from green CI, an advisory Council vote, a local `git diff`, or a forged `productionAccepted` field.
