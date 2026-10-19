# Mahoraga to Ultron lift-and-shift map

## Purpose

Ultron remains an independent product and authority boundary. This tranche uses Mahoraga as owned historical source material and as a regression corpus. It copies proven contracts into Ultron, adapts names and authority references, and verifies the resulting behavior in Ultron. It does not add a runtime dependency on Mahoraga or treat Mahoraga deployment evidence as Ultron acceptance.

## Reuse matrix

| Mahoraga source | Mahoraga regression | Ultron target | Treatment |
|---|---|---|---|
| `src/metacognition.mjs` | `test/metacognition.test.mjs` | `src/metacognition.mjs`, `test/metacognition.test.mjs` | Direct behavioral lift: evidence coverage, confidence calibration, known unknowns, conflict handling and fail-closed limits |
| `src/cognitive-world-model.mjs` | `test/cognitive-world-model.test.mjs` | `src/cognitive-world-model.mjs`, `test/cognitive-world-model.test.mjs` | Direct behavioral lift: immutable counterfactual transitions and bounded uncertainty propagation |
| `src/cognitive-individual.mjs` | `test/cognitive-individual.test.mjs` | `src/cognitive-individual.mjs`, `test/cognitive-individual.test.mjs` | Lifted identity, private episodic references, public projection and trait validation; authority source renamed to Ultron's capability registry |
| `src/collective-cognition.mjs` | `test/collective-cognition.test.mjs` | `src/collective-cognition.mjs`, `test/collective-cognition.test.mjs` | Direct behavioral lift: perspective coverage and preservation of high-confidence material dissent |
| `src/grokbot-cognition.ts` and `src/grokbot-host.ts` | `test/grokbot-cognition.test.ts`, `test/grokbot-host.test.ts` | `src/grokbot-governor.mjs`, `test/grokbot-governor.test.mjs`, `test/cognition-http.test.mjs` | Contract lift, implementation adaptation: fixed in-process advisory roles replace worker threads because Ultron has no admitted operational bot lane |
| `src/sovereign-evolution.mjs` | `test/sovereign-evolution.test.mjs` | `docs/core/cycle.mjs`, `test/cycle.test.mjs` | Pattern lift: incumbent evaluates and commits the next routing artifact; candidate cannot self-approve; rollback and authority invariants are explicit |

## Ultron-specific integration

`POST /api/plan` still persists a non-executing plan before any tool runs. It now also attaches a `grokbot-deliberation-receipt` containing:

- three stable public cognitive profiles: Builder, Skeptic and Steward;
- a metacognitive assessment with evidence and calibration gaps;
- a counterfactual transition with propagated uncertainty;
- each role's position and evidence references;
- collective synthesis that preserves material dissent;
- an explicit advisory-only authority block;
- `modelInvocations: 0`, `creditCost: 0` and `paidFallback: false`.

The existing planner and capability registry remain authoritative. Cognitive personality never creates permissions, and a council decision never executes a step. The same receipt is attached to local saved plans and GitHub cloud outcomes, including the fixed hourly `/repo inspect` heartbeat; refused cloud objectives receive a `hold` receipt before any GitHub API read.

Routing evolution now follows Serve → Observe → Grow → Commit:

- **Serve:** the existing planner/executor serves bounded requests.
- **Observe:** verified receipts and owner ratings remain the only real outcome evidence.
- **Grow:** the candidate is measured on held-out cases it does not author at runtime.
- **Commit:** the incumbent emits a promotion receipt with the measured threshold, zero regressions, rollback version and unchanged action authority.

This structure is compatible with a future Reef harness adapter, but Reef was not installed or executed for this tranche. No claim of Reef training, model-weight update or artifact deployment is made.

## Deliberately not imported

The following Mahoraga surfaces were not copied because Ultron lacks the prerequisite authority, isolation or acceptance evidence:

- `self-evolution-worker.mjs`: Ultron has no contained code-writing worker, candidate worktree lane or protected exact-head promotion path.
- operational GrokBot worker threads: Ultron has no independently admitted bot capability or execution lease.
- broad provider federation: Ultron currently exposes deterministic reads plus explicitly enabled local/browser inference only.
- autonomous merge or deployment: Ultron `main` was documented as unprotected, and source workflows do not create branch protection.
- Cloudflare, Railway or Mahoraga runtime bindings: Ultron's hosted lane is GitHub Actions and Pages; predecessor infrastructure has zero authority here.

These are evidence gaps, not placeholders silently treated as complete. A later tranche may port them only after Ultron has exact task, attempt, budget, path-fence, worktree, verification, rollback and protected-merge contracts of its own.

## Regression procedure

The port used a narrow red-green loop:

1. copy or adapt the Mahoraga regression expectations into Ultron;
2. observe missing-module or missing-integration failures;
3. add the smallest compatible Ultron implementation;
4. rerun focused cognitive and promotion tests;
5. run `node scripts/verify.mjs` across every source module and regression test;
6. require fresh GitHub exact-head verification after the branch is published.

Local source verification cannot establish Pages publication, live GitHub task execution, model quality, consciousness, general intelligence or autonomous release authority.
