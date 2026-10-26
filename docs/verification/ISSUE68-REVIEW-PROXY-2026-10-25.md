# Issue #68 — GitHub review-count proxy is not a held-out evaluation

Scope: PR #106, existing `issue-68-stage-1` objective. Stage 3 repair; no new branch, provider, runtime, paid job, or release authority.

## Independent review and repaired implementation

CodeRabbit's exact-head review on `4d503d3c526e2e29d3396ecd182bc687508f6862` found three major issues: a broken owner acceptance API call, mutable manifest comments accepted as frozen, and review-body spoofing by arbitrary GitHub users. The repair uses positional API arguments, rejects edited manifests, and pins review authorship to the GitHub-supplied CodeRabbit bot login, numeric ID, and Bot account type. Numeric pull numbers are validated before GitHub lookup. The manifest event timestamp uses the actual GitHub freeze time, not a fabricated pre-task timestamp.

Stage 4 additionally objected that different PRs' CodeRabbit actionable-comment counts do not constitute comparable, disjoint, held-out evaluation cases. This objection is valid: one review provider cannot independently attest its own comparative evaluation, and a manifest assertion of `setsDisjoint:true` is not evidence of a fixed, disjoint test set.

## Deliberate fail-closed boundary

The GitHub review-count comparison is now explicitly `advisory-review-count-proxy`. The owner-authored pre-review comment must use `ultron-review-proxy-manifest:v1` and schema `ultron.github-review-proxy-manifest.v1`, with `setsDisjoint:false`; the old held-out-manifest marker is rejected. It is stored for audit with a proxy-specific schema and non-passing outcome status. It has `setsDisjoint:false`, `independentlyObserved:false`, unknown critical-regression/failure counts, a proxy evaluator (not the CodeRabbit reviewer), and an untrusted proxy readback kind. `verifyPersistedAcceptanceEvidence` may attest the genuine independent CodeRabbit reviewer only after current GitHub readback and consistency checks; it **always returns `evaluation:false`** for this proxy. The existing council promotion gate consequently remains held. No review-count delta may be promoted to protected held-out improvement evidence.

This deliberately narrows PR #106's claim. A real held-out gate still requires a pre-registered fixed/disjoint case set, independently observed case-level outcomes, baseline and candidate on comparable tasks, source/runtime SHA binding, adversarial negative tests, and independent evaluator authority.

## Test and acceptance evidence

- Reproduced five focused RED failures for edited manifests, forged candidate/baseline reviews, invalid pull-number typing, and the broken owner route.
- Added a failing proxy-boundary test before the advisory-only correction.
- Focused tests include stale reviewed head, post-review freeze, tampered proxy flags and correlated reviewer/evaluator roles.
- Run `node --test test/hatchable-acceptance-evidence.test.mjs`, `node scripts/verify.mjs`, and `git diff --check` on the exact candidate head. GitHub PR-head Verify must independently pass.
- The old frozen manifest for `4d503...` cannot apply to any subsequent head. Freeze a new owner-authored, unedited manifest before another external review. Re-run CodeRabbit independently; do not self-approve.
- No deployment, merge, external write, or Issue #95 canary is authorized by this repair.

## Fixed base/candidate comparison (replaces proxy-only performance claim)

The frozen benchmark is defined in `scripts/compare-acceptance-evidence.mjs` as eight deterministic case IDs, a SHA-256 case-set digest, and a SHA-256 digest of the **entire evaluator source** in each output report (so unchanged IDs cannot mask changed fixture logic). The immutable evidence boundary is the Git tree of the **exact PR HEAD**, not an editable PR comment. `fixed-comparison` in `.github/workflows/verify.yml` checks out the exact PR head with full history and runs the identical case definitions against `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`. It records per-case, source-SHA-bound simulated task/event pairs, writes a JSON artifact and reads it back. These are **CI-local readbacks**, not durable production PostgreSQL receipts.

The evaluation contains five acceptance-adapter cases (valid review, edited freeze, forged bot, stale main, non-promoting proxy) and three council-gate cases (unknown external write, stale lease, duplicate action). The baseline did not contain the adapter; its five missing-capability failures must not be presented as a measure of general reasoning quality. The deterministic GitHub Actions comparison is repeatable and source-bound, but **not independent, blinded, disjoint from development, or an attested held-out evaluation**. Its manifest explicitly says `heldOutCertified:false`, `independentEvaluator:false`, and `eligibleForProtectedPromotion:false`.

Verified at initial comparison head `ab4b8a9fa818f998ba7a5b8afe73a70dc11d4a26`: GitHub Actions run `40253286476` completed `test` and `fixed-comparison` successfully; artifact `12621800160` reported 3/8 base versus 8/8 candidate cases. Subsequent documentation-only edits require another exact-head CI readback before handoff.

Owner comment #6405719156 and the older comment #6404933375 are **not** immutable approval for any changed head; they must not be reused as a final reviewer or held-out authorization. Require a new independent review of the final head. The separate protected held-out evaluation and live PostgreSQL acceptance remain HOLD until independently sourced case definitions, independently attested evaluator identity, and real event/task receipt readbacks are established. No merge or deployment authority is added.
