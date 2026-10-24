# Verifier-gated cognition calibration: Ultron and Mahoraga (2026-10-24)

## Evidence and design lineage

[Ultron issue #68](https://github.com/michaeljwilliams0123/Ultron.MW/issues/68) requests episodic memory, prediction ledger, held-out outcomes, and observable learning. Ultron already contains `src/cognitive-world-model.mjs`, `src/metacognition.mjs`, `src/learning.mjs`, and `src/self-observer.mjs`; their deterministic state transforms and proposal-evaluation gates should be extended, **not replaced**. Historical Mahoraga [PR #838](https://github.com/michaeljwilliams0123/mahoraga/pull/838) proposed realized-outcome calibration, but its merge is unverified / not recorded as landed. [PR #881](https://github.com/michaeljwilliams0123/mahoraga/pull/881) explores held-out calibration in the cockpit. Landed Mahoraga [PR #1147](https://github.com/michaeljwilliams0123/mahoraga/pull/1147) and [PR #1148](https://github.com/michaeljwilliams0123/mahoraga/pull/1148) provide the more reliable pattern: project genuine provider results onto a task-bound, validated receipt and reject internally impossible claims.

This PR adds a separately importable, deterministic **probabilistic prediction-evaluation contract** rather than introducing a new model, route, UI, hosted plane, dependency, provider bill, or automatic policy promotion. It does not start an agent, dispatch actions, create PRs, or grant authority.

## Contract and trust separation

1. **Before outcome**: record a fixed binary prediction probability `p ∈ [0,1]` tied to task ID, exact source SHA, question digest, forecast timestamp, deadline, and original registration receipt ID. `registerForecast` makes a structural fingerprint; this is **not** a server timestamp, signature, or proof of preregistration. A privileged append-only ledger must store and independently timestamp that record *before* outcome materializes.
2. **After outcome**: an independently authorized readback adapter supplies an immutable external outcome receipt, observed timestamp later than forecast/deadline, boolean result and source content SHA-256. The adapter must validate the external resource, relevant actor/grant, actual side effect, and observation time. An LLM-generated receipt, user-local callback, hash without source check, GitHub issue comment assertion, and mock test cannot certify an outcome.
3. **Evaluation**: inject `verifyEvidence({forecast,outcome})` from the separately trusted adapter. Require a verified proof digest, exact registration/outcome IDs, and a distinct verifier ID for every case. Evaluate only 5–1000 complete unique task pairs; reject tampered forecasts, missing or early outcomes, mismatched receipts, unknown verifier, or duplicates. Sorting makes the resulting fingerprint invariant to input order.
4. **Metrics**: Brier score (lower is better), delta vs fixed 0.5-probability baseline (0.25 Brier), and weighted four-bin expected calibration error, retaining case-level lineage. These are **evaluation metrics**, not a machine's intelligence level or production success metric. A sample of five is only a developer contract floor, not statistically persuasive evidence.
5. **Readiness**: the returned `status: evidence-admitted` means the injected verifier asserted correlated source evidence; it does **not** prove the verifier is genuinely independent. Independent reviewer approval, trusted server-side verifier wiring, non-editable registration ledger, held-out blind tasks, production source-of-truth reads, cost accounting, out-of-distribution challenges, drift handling, deletion/retention, and owner-controlled rollback must be established separately.

## AGI / SGI / Sentience acceptance vocabulary

- **Adaptive autonomy:** evidence of executing newly encountered objectives with bounded external actions and observable task outcomes; measure completion, human intervention, postcondition accuracy, retry/duplicate rate, cost and latency.
- **Generalization:** score unforeseen tasks across reasoning, coding, browser, research and tool use, compare against frozen baseline and avoid overlap between development and held-out cases.
- **Self-monitoring:** confidence vs empirical observed success, prediction error, uncertainty, source freshness, error recovery and transparent failure; no claim that inward-looking metadata indicates subjective awareness.
- **Self-improvement:** candidate skill/harness changes proposed as reviewable PRs; promote only after independent held-out improvement and protected CI, a rollback, and verified production parity.
- **Consciousness / sentience:** not a testable product property established by this ledger or the present repository evidence; avoid assigning an invented percentage or treating autonomy, dialogue continuity or a persistent scheduler as evidence of subjective experience.

## Test and release sequence

Run `node --test test/prediction-calibration.test.mjs` and `node scripts/verify.mjs`. Have a reviewer challenge adversarial attribution, timing, evidence adapter trust, tamper rejection, incomplete cases and calibration math. Follow protected PR/CI and exact source-head checks. Only after owner acceptance should a separate integration PR connect an authenticated evidence writer, external verifier and the existing Pages UI.

This source-only change is **not deployed** to the private Hatchable cloud brain and does not add any cloud credentials. Model outputs, account identifiers, private task bodies, tokens and Descope cookies never belong in public GitHub evidence.
