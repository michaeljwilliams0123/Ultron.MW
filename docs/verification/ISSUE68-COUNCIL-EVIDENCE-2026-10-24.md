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
4. A frozen, disjoint before/after evaluation bound to the same source SHA and matching postmerge runtime source SHA. Its event ID and observation time come from the durable ledger, not the submitted payload. A separate frozen-set manifest must predate the outcomes and name each disjoint baseline/candidate task pair.
5. Independently observed terminal outcome readbacks, with every declared task mapped one-to-one to a separately loaded durable `observed` event. The joined task objective and result must match the manifest objective, source, set, case and variant. Baseline/candidate scores, failures and critical regressions are recomputed from these readbacks and must exactly match the evaluation record.
6. Readback reconciliation for uncertain external writes. A readback proving the action already committed suppresses replay; missing readback holds the candidate.

Every source-bearing observation is collected between two identical `main`
readbacks. CI is filtered to that SHA and counts only the newest completed,
successful `Ultron core verification` push whose complete jobs inventory has one
successful `test` job. A merely non-failing, queued, cancelled, timed-out,
`action_required`, incomplete or cross-SHA run is not green evidence. PR
inventory truncation holds. Site rendering remains unverified until the served
HTML publishes an `ultron-source-sha` meta value equal to the observed source;
visual app-shell presence alone is not deployment parity.

The council decision itself also reads live `main` before and after its SQL
evaluation. Reviewer attestations, independent assessments and held-out
evaluations are selected by exact objective ID and live source SHA in SQL and
filtered again after retrieval. A stale stored `repo.inspect` result therefore
conflicts with the live source instead of becoming the decision anchor, and
unrelated ledger events cannot evict or contaminate the selected evidence.

Allowlisted adapter names are not authentication. The current hosted runtime
has no trusted producer/readback implementation for independent-reviewer or
held-out-evaluation events, so its caller supplies no trusted adapter evidence
and the gate remains held even if matching rows are present. The generic policy
can model a future trusted caller, but source merge, a GitHub identity, a
fingerprint, or a hand-authored SQL row does not establish that boundary.

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
- evidence collected across moving `main`, incomplete CI inventories, wrong-head
  workflows and missing or unsuccessful required jobs;
- assessment timestamps before their evidence or after the evaluation time;
- forged readback-adapter identifiers;
- forged, duplicate, missing or stale held-out evaluation lineage;
- unrelated observed task results and self-reported score/count mismatches;
- missing frozen-set manifests or baseline/candidate case bindings;
- matching adapter labels without a configured trusted producer/readback;
- unrelated ledger evidence and a stale stored-main observation;
- movement of live `main` during council evaluation;
- unknown or duplicate external-action records;
- negative candidate-failure or critical-regression counts;
- atomic SQL persistence of assessment events with council completion.

## Non-claims and remaining acceptance

Passing source tests does not establish live Hatchable deployment, production database migration behavior, an independent reviewer, provider readiness, measured improvement, AGI, SGI, sentience or consciousness. A protected merge still requires exact-head CI and owner confirmation. The current public Pages HTML does not itself attest its deployment SHA. Any later Hatchable deployment requires a fresh versioned manifest comparison, rollback target, owner-authenticated canary and durable SQL readback at the deployed source identity.
