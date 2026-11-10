# Ultron.MW — Tasks 1–5 Canary Pipeline: Final Source Acceptance and Owner Handoff

**Checkpoint:** 2026-11-10 · **Repository:** `michaeljwilliams0123/Ultron.MW` · **Classification:** `SOURCE_ACCEPTED / PRODUCTION_HOLD`.

This document is the **source-only acceptance record** for the unified GitHub App identity factory (Task 1), cryptographic persona/nonce interceptor (Task 2), prepare-only dispatcher (Task 3), PostgreSQL idempotent executor (Task 4), local audit receipt (Task 5), and master conductor. A green source PR, Council or Reef workflow **does not** demonstrate a live Hatchable/GitHub provider write, production migration, deployment or full end-user acceptance. Owner `michaeljwilliams0123` will personally review and squash-merge; **no auto-merge**.

## Source acceptance — verified / concluded

- [x] **AC-S01: Repository-bound identity.** The single GitHub App installation is checked against the exact repository ID; issued tokens are short-lived and restricted to the validated operation, repository ID and exact permissions. No standing admin step-up, token reuse beyond scope, token-bearing logs or UI output.
- [x] **AC-S02: Owner-signed authority.** Task 2 verifies the exact signed plan, role, SHA-256 digest, operation, signature, clock/expiry, PostgreSQL migration 0037 nonce uniqueness and replay denial. Council persona attribution does not create another GitHub identity or approval.
- [x] **AC-S03: Preparation without mutation.** Task 3 preserves signed task ID, `ultron/canary-*` branch, 40-hex source SHA and 64-hex operation digest, with approval flags enabled; `prepareOnly` never runs the graph or grants execution.
- [x] **AC-S04: Durable one-write semantics.** Task 4 reserves in migration 0039 before dispatch; concurrent/duplicate/uncertain writes are reconciled by provider and PostgreSQL readback rather than blindly POSTed again. Invalid, expired, revoked or changed authority denies a new effect.
- [x] **AC-S05: Commit provenance before persistence.** For signed `ultron/canary-*` tasks, Task 4 rejects an absent source SHA, mismatched Git commit parent/tree, wrong operation-digest trailer or moving ref **before** a terminal `completed` ledger receipt. Mismatches hold in `reconcile_required` with no successful receipt. The conductor performs an additional independent ref/parent/tree verification after executor completion.
- [x] **AC-S06: Separate local audit and remote effect evidence.** Task 5 writes create-once, canonical, digest-checked local receipts; symlinks and tampering are rejected. It never calls a local `git diff` or audit-file creation proof of an authenticated remote write. Remote verification belongs to the durable executor and independent provider readback.
- [x] **AC-S07: Failure and adversarial coverage.** Real source modules are composed in an ephemeral PGlite + simulated GitHub HTTP harness covering signed happy path, new-nonce completed replay, nonce reuse denial, lost acknowledgment with/without effect, owner stop/revoke, forged parent, altered tree, and changed branch HEAD.
- [x] **AC-S08: Minimal integration.** The master conductor passes Task 2's canonical scope directly to Task 1; obsolete operation-string shim removed. No additional app, backend, signer, SDK, service, paid inference or shell bypass added.
- [x] **AC-S09: Exact pinned source CI.** All required Core Verify jobs (`test`, `fixed-comparison`, `attested-receipt`) passed at the **pinned** heads below. Workflows and checks must be re-evaluated if any head changes.

### Pinning and verification evidence

| Scope | Source head (before this documentation commit) | Latest verified Core run | Evidence |
| --- | --- | --- | --- |
| [Task 4 #365](https://github.com/michaeljwilliams0123/Ultron.MW/pull/365) | `a733b9b0e97102974fe8856449fb5950e769e347` | [#42764876266](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42764876266) SUCCESS | 1,768 pass / 0 fail / 18 existing skipped; PostgreSQL 40/40 |
| [Master conductor #366](https://github.com/michaeljwilliams0123/Ultron.MW/pull/366) | `f317e3371a5f862e408cbe0a255e15b056e43d3b` | [#42765351065](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42765351065) SUCCESS | 1,749 pass / 0 fail / 18 existing skipped; PostgreSQL 40/40 |
| [Combined integration #368](https://github.com/michaeljwilliams0123/Ultron.MW/pull/368) | `9ee9d33ea59d28d8edc8794e74c1c04f7aaf0f31` | [#42765114685](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42765114685) SUCCESS | 1,852 pass / 0 fail / 18 existing skipped; PostgreSQL 40/40 |

**Reproduced RED → GREEN:** [RED #42764277761](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42764277761) showed two incorrect persisted `completed` receipts for forged parent/tree; subsequent [GREEN #42764670932](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42764670932) passed both real-PGlite regressions. Changes were backported to original [Task 4 #365](https://github.com/michaeljwilliams0123/Ultron.MW/pull/365). Earlier forged-parent false-positive and async token-label race also have RED→GREEN evidence in the associated PR histories.

## Owner squash-merge checklist — source only

- [ ] Review the **current** changed files, latest SHA and all required checks/review threads/rulesets on **each** PR. Current source evidence is pinned, not a guarantee after future changes.
- [ ] Prefer source PR dependency order **#361 → #362 → #363 → #365 → #364 → #366**. Task 3's direct graph CLI remains separate from preparation. No direct-main write or protection bypass.
- [ ] **Do not squash #367 or #368 into main as duplicate aggregate source PRs.** These are synthetic integration evidence branches, not independent additional features. Before closing them, preserve/port `test/canary-real-integration.test.mjs` and any unique regression cases into an appropriate canonical source/main test PR after dependencies land.
- [ ] Re-run the combined exact-`main` test, PostgreSQL/migration checks, fixed comparison and attested receipt **after** owner squashes; verify imports, contracts, expected CI graph and a clean merge outcome.
- [ ] Preserve existing open operator and evidence trackers [#167](https://github.com/michaeljwilliams0123/Ultron.MW/issues/167), [#204](https://github.com/michaeljwilliams0123/Ultron.MW/issues/204), [#285](https://github.com/michaeljwilliams0123/Ultron.MW/issues/285). No `Closes #167`, `Closes #204` or `Closes #285` keywords.

The owner is the **sole required human reviewer/signing authority** under the current issue policy, subject to actual GitHub protection and third-party restrictions; this does not waive technical security, exact-head CI, cryptographic authorization, stop/revoke, provenance or audit gates.

## Production and end-user acceptance — NOT YET SATISFIED

- [ ] **AC-L01 — Real identity and authority:** Verify live GitHub App installation identity, narrowly scoped token profile, owner-controlled P-256 signed authorization and current expiry/revocation/stop state. No signer/secret supplied by task input and no credential exposure.
- [ ] **AC-L02 — Real durable state:** Apply and independently reread migrations 0037 and 0039 in the **existing** Hatchable PostgreSQL service; prove unique nonce and execution-key state after process restart.
- [ ] **AC-L03 — Existing Hatchable cloud composition:** Bind actual Tasks 1–5 through one owner-facing Hatchable workflow; use PostgreSQL as execution owner and GitHub as source/CI/provider of record. No parallel app, local-desktop prerequisite, or unauthorized service.
- [ ] **AC-L04 — Bounded provider write:** Execute one owner-authorized nonprotected-branch canary via the real GitHub App; independently refresh branch HEAD, commit SHA, exact digest trailer, signed parent and tree, receipt and task identity from authenticated provider and database records. Do not mistake a successful callback for a verified mutation.
- [ ] **AC-L05 — Recovery, denial and idempotency:** Prove replayed signed nonce and expired/revoked/changed plan are denied; concurrent delivery, lost ACK and worker restart never create a duplicate remote effect; owner stop/pause prevents fresh mutation.
- [ ] **AC-L06 — Release/user-visible outcome:** Observe exact-head CI, protected owner-controlled release (if separately authorized), current deployed Hatchable version, and matching user-facing audited outcome. Every outcome classified PASS / FAIL / BLOCKED with task fingerprint, remote URL/SHA, attempts, immutable receipt, evidence timestamp, and $0 incremental paid spend.
- [ ] **AC-L07 — Evidence sign-off:** Post independent live provider and PostgreSQL readbacks to #167 / #204 / #285 and separately close only the criteria actually proven. Previously verified controlled Hatchable effect [#341](https://github.com/michaeljwilliams0123/Ultron.MW/issues/341) is **not** full Council Room→GitHub pipeline acceptance.

**Current release decision:** `SOURCE_ACCEPTED` on pinned tested trees; `OWNER_SQUASH_PENDING`; `LIVE_CANARY_NOT_VERIFIED`; `PRODUCTION_HOLD`. No merge, deployment, production migration, secret change or real provider mutation is authorized or claimed by this record.
