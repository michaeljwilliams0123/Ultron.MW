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

The frozen benchmark is defined in `scripts/compare-acceptance-evidence.mjs` as ten deterministic case IDs, a SHA-256 case-set digest, and a SHA-256 digest of the **entire evaluator source** in each output report (so unchanged IDs cannot mask changed fixture logic). The immutable evidence boundary is the Git tree of the **exact PR HEAD**, not an editable PR comment. `fixed-comparison` in `.github/workflows/verify.yml` checks out the exact PR head with full history and runs the identical case definitions against `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`. It records per-case, source-SHA-bound simulated task/event pairs, writes a JSON artifact and reads it back. These are **CI-local readbacks**, not durable production PostgreSQL receipts.

The evaluation contains seven acceptance-adapter cases (valid review, edited freeze, individually forged login, numeric ID and Bot type, stale main, non-promoting proxy) and three council-gate cases (unknown external write, stale lease, duplicate action). The baseline did not contain the adapter; its seven missing-capability failures must not be presented as a measure of general reasoning quality. The deterministic GitHub Actions comparison is repeatable and source-bound, but **not independent, blinded, disjoint from development, or an attested held-out evaluation**. Its manifest explicitly says `heldOutCertified:false`, `independentEvaluator:false`, and `eligibleForProtectedPromotion:false`.

Verified at initial comparison head `ab4b8a9fa818f998ba7a5b8afe73a70dc11d4a26`: GitHub Actions run `40253286476` completed `test` and `fixed-comparison` successfully; artifact `12621800160` reported 3/8 base versus 8/8 candidate cases at that historical commit; this is superseded by the ten-case suite. Subsequent documentation-only edits require another exact-head CI readback before handoff.

Owner comment #6405719156 and the older comment #6404933375 are **not** immutable approval for any changed head; they must not be reused as a final reviewer or held-out authorization. Require a new independent review of the final head. The separate protected held-out evaluation and live PostgreSQL acceptance remain HOLD until independently sourced case definitions, independently attested evaluator identity, and real event/task receipt readbacks are established. No merge or deployment authority is added.

## Adversarial branching coverage (October 26)

The local Brancha comparison on SD009WC7 considered four independent threat families: (A) reviewer identity spoofing, (B) frozen-manifest and stale SHA, (C) false-positive/readback outages, and (D) comparison/evaluator integrity. Added negative regressions for numeric-like baseline strings (`"103"`, whitespace, scientific notation, hex, null and booleans), duplicate matching frozen manifests, individual GitHub login/ID/type spoofing, GitHub 429 readback failure, and a mutated verifier returning `{reviewer:false,evaluation:false}`. The fixed comparison now counts each of login, ID, and Bot-type attacks separately, bringing its total to ten cases. A failing test-only CI run #40255384371 established RED for expanded benchmark expectations; the implementation retained the strict baseline validation, categorized fail-closed logging and reviewer trust requirement, and split the three spoofing cases while preserving the non-promotion boundary. A later test-only expectation was corrected for the ten-case suite. Exact final HEAD CI must pass before review/merge.

The older owner approval and pre-review proxy manifest refer to older SHAs and cannot be treated as independent reviewer attestations of this changed head. The deterministic tests remain advisory and cannot qualify as independently held-out evaluation or live PostgreSQL receipts.
