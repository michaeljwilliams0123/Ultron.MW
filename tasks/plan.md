# Implementation Plan: Ultron MW v142 evidence and repository operator acceptance

## Overview
Establish defensible production release evidence and a bounded, authenticated C04 external effect, then independently verify issues #173, #167, #168 and #170. Maintain protected GitHub `main`, owner P-256 authority, $0 incremental paid spend and Cloudflare optionality. Source tests must not promote themselves to runtime acceptance.

## Architecture decisions
- Hatchable/PostgreSQL is the authoritative execution/evidence plane; GitHub is the independent provider for PR/ref/comment/CI readbacks.
- Use the existing `deployment-release-receipt`, `release-proof`, `github-pr-comment-canary`, and Reef/repair components; do not introduce a parallel workflow or ledger.
- Every evidence claim binds target version, exact main/source SHA, SHA256 digest, owner authority, provider identity and immutable receipt.
- For combinatorial coverage, generate many **offline deterministic** cases; maintain a separate count of actual tests versus production effects.
- The parent issue #285 was closed, but its in-body acceptance is not verified. Log the discrepancy; do not claim acceptance or overwrite evidence.

## Ordered task list
### Phase 1 — research and evidence
1. **Baseline and file parity** (S, complete): exact GitHub SHA and Hatchable v142 manifest match 267/267. Verification: independent local SHA-256 comparison; saved path-only output.
2. **Release negative proof** (S, complete): show live `ci=true`, `council=true`, `deployment=false`, old v140 receipt, C04 idle and zero recorded effects. Verification: owner-only GET and read-only PostgreSQL readback.
3. **Combinatorial security regressions** (S): 16,384+ offline cases across actual plan/receipt/digest validators, plus existing focused suites. Verification: node --test, exact count, deterministic rerun, no provider calls.
### Phase 2 — authenticated production acceptance
4. **v142 release attestation** (M, gated): current manifest's canonical digest; owner signs exact `cloud.deploy` resource with versioned authorization through existing UI; one submission; independent DB and live manifest GET match. Verification: immutable receipt and release-proof `verified:true` for the same source version. No automatic owner signing.
5. **C04 live effect** (M, gated): select a **currently open** eligible PR (not merged #447); owner approves one exact comment; protected Coordinator installation performs one external effect; verify comment author/body marker via GitHub and durable ledger; ambiguous ACK and replay do not cause duplicate mutation. Verification: provider-side comment ID and ledger record, mutation count exactly one.
### Phase 3 — related issue contracts
6. **#173 Reef independence** (M): immutable held-out corpus, independent evaluator identity, exact-head candidate/base SHA and ABSTAIN for unavailable evidence; no model self-approval. Verify with real evaluator receipts and adversarial negative suite.
7. **#167 operator** (M): owner-scoped branch create, independent ref/commit/tree readback, PostgreSQL terminal receipt; deny stale, revoked, expired and cross-repo conditions. Verify live authorized one-effect canary.
8. **#168 autonomous repair** (M): failing exact-head test => bounded isolated repair => CI => independent review, with lost-ACK and CAS replay guard. Verify genuine patched PR and negative-case ledger.
9. **#170 UI** (M): one Hatchable conversational UX for authorized commands and evidence; mobile/desktop auth, stop/resume and rollback; do not retire Pages without route parity and rollback verification.
### Checkpoint — exact release
10. **Reconcile**: re-fetch current main and deployment version, CI/Gate statuses, v142 signed artifact/manifest, production C04 effect, and each issue's original gate. Mark PASS only with independent receipts; retain BLOCKED otherwise.

## Risk and mitigations
- **False production certification:** force source SHA and live deployment receipt equality; never count source CI as deployment.
- **Duplicate provider write:** reserve idempotency before submit and reconcile ambiguous outcome by provider GET, not retry.
- **Owner signing and secrets:** owner completes passkey in trusted UI; assistant never handles keys, token values or grant envelopes.
- **Unbounded test burden:** fixed seeded offline test matrix and focused tests; no massive production request floods.
- **Parallel worktrees:** isolated branch based on exact remote main; preserve divergent existing user checkouts.

## Task tracking
The ordered checklist is in `tasks/todo.md`. GitHub issues #285/#167/#168/#170/#173 remain the production acceptance trackers. No issue closure from tests alone.
