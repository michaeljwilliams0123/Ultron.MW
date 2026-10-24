# Issue #68 — hosted council evidence contract

Date: 2026-10-24
Scope: source and tests only until separately deployed and accepted
Issue: [#68](https://github.com/michaeljwilliams0123/Ultron.MW/issues/68)

## Result

This change evolves the existing Hatchable `council.review` objective; it does not create another brain, queue or hosted service. The four existing deterministic profiles now produce versioned assessment receipts when their underlying SQL task and event receipts are available. Each assessment binds:

- the durable council objective identity;
- the exact observed GitHub source SHA;
- the source task ID and its durable `observed` event ID;
- the role and explicit `deterministic-role-profile` reviewer class;
- evidence observation time and freshness;
- assessment, next inspection, material dissent and known unknowns;
- advisory-only authority, zero model invocations, zero credit cost and no paid fallback.

The worker persists these assessment rows as `council-assessment` events inside the same PostgreSQL statement that performs lease-fenced task completion and writes the ordinary `observed` event. There is no second assessment write that could diverge from task state.

## Fail-closed selection gate

The gate can return only `held` or `eligible-for-protected-pr`. It always returns `eligibleForExecution: false` and cannot merge, deploy, grant capabilities or change action authority.

Eligibility requires all of the following:

1. At least one valid assessment and at least one genuinely independent reviewer identity. The referenced identity event must be separately read from the durable ledger as an `independent-reviewer-attested` event and must match the objective, source SHA, reviewer, identity source, freshness and trusted readback adapter. Self-carried identity fields, multiple deterministic profiles, or a profile with only its label changed do not satisfy this condition.
2. No duplicate replay, malformed receipt, contradictory role position, material unresolved dissent, stale evidence, source mismatch or stale/mismatched lease.
3. If a provider is required, independently established readiness and required-token presence. The gate performs no provider call and spends no credits.
4. A frozen, disjoint before/after evaluation bound to the same source SHA and matching postmerge runtime source SHA.
5. Independently observed terminal outcome readbacks, positive held-out gain, zero candidate failures and zero critical regressions.
6. Readback reconciliation for uncertain external writes. A readback proving the action already committed suppresses replay; missing readback holds the candidate.

Existing `src/learning.mjs` remains the canonical detailed skill/harness scorer. This hosted gate does not duplicate that scorer or claim that a candidate exists merely because council text was generated.

## Regression matrix

The focused tests cover:

- zero receipts;
- four deterministic roles incorrectly treated as independent reviewers;
- a self-asserted independent identity without a separately read durable attestation event;
- duplicate receipt replay;
- conflicting assessments for one role;
- stale evidence and stale source SHA;
- stale or mismatched worker lease;
- required-provider denial and missing required token evidence;
- self-reported or hallucinated success without observed readbacks;
- an externally committed action whose response was lost, reconciled without replay;
- held-out candidate failure;
- postmerge source/runtime mismatch;
- malformed task-receipt lineage;
- atomic SQL persistence of assessment events with council completion.

## Non-claims and remaining acceptance

Passing source tests does not establish live Hatchable deployment, production database migration behavior, an independent reviewer, provider readiness, measured improvement, AGI, SGI, sentience or consciousness. A protected merge still requires exact-head CI and owner confirmation. Any later Hatchable deployment requires a fresh versioned manifest comparison, rollback target, owner-authenticated canary and durable SQL readback at the deployed source identity.
