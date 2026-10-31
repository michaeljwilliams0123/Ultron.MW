# Reef paired Repair App evaluation integration (Issue #173)

This is a **versioned comparison of real executable repository policy behavior**, with the case results reported back to a real Reef runtime. It is not yet Reef's trainable Cordis harness-evolution recipe, and cannot certify a model or an autonomous self-repair operator.

## Execution on GitHub

The read-only `.github/workflows/reef-runtime-probe.yml` job:
1. Installs the hash-checked `reef-infra==0.1.3` package and verifies the protocol smoke.
2. On PRs, evaluates exact `base.sha` versus exact `head.sha` of `src/repair-admission.mjs` using actual Node module behavior, not a static count of changed lines.
3. On **future** PRs where the evaluator exists on the trusted base, extracts `scripts/reef-paired-cases.mjs` directly from the base SHA, so the PR cannot edit its own evaluator. During this bootstrap PR, there is no trusted base evaluator and `evaluatorFromProtectedBase=false`.
4. Runs ten disjoint cases: two development cases and eight held-out security/authority-negative cases. The benchmark records base/candidate source SHA and source digests, case-set digest, true behavioral scores and critical regressions.
5. Starts an actual Reef server using the deterministic loopback fixture and **records a separate request and feedback receipt for every baseline and candidate case**, with the observed pass/fail score attached.
6. Uploads the sanitized source-comparison and Reef receipt artifacts. No raw prompts, logs, secrets or credentials are published.

## What this proves

- Exact versioned deterministic Repair App policy behavior is compared for two real revisions.
- The scored results are carried into live Reef feedback records.
- A change that admits a prohibited merge or changes policy unexpectedly is observable as a security regression.
- Reef receipts are not substitute task-outcome evidence: the independent validator is GitHub-hosted Node test code; the Reef upstream is only an inert protocol fixture.

## What this does **not** prove

- An AI planner or autonomous agent actually proposed a fix, learned, or performed a real repo PR task.
- A model has been evaluated, optimized, or trained with Reef's `CordisRecipe`.
- Held-out tasks are blinded or certified by a distinct external reviewer: they are checked into the repository.
- A specific PR is ready for protected merge. Every uploaded report deliberately sets `eligibleForMerge=false`.
- Any Admin App or Hatchable UI acceptance from issues #169/#170.

## Next required gate

For #168: exercise a real isolated failing-test → repair → protected PR workflow under the live Repair App identity, with independent restart/response-loss and permission-denial evidence. Run paired harness episodes under a configured Reef recipe, ensure independently scored held-out tasks and complete receipt-based lineage. For #169 and #170: add separate, immutable case suites and actual scenario execution; do not reuse the Repair App policy benchmark as a false proxy.

**Standing rule:** Do not merge #168–#170 implementation PRs based on this protocol harness alone. Require complete, independently reviewed Reef candidate acceptance plus normal exact-head GitHub checks.
