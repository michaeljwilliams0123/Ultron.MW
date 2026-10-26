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
